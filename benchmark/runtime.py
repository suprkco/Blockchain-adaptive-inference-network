"""Persistent split MiniLM workers with bounded, non-pickle tensor messages."""
import hashlib
import json
import multiprocessing as mp
import os
import struct
import time

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
MAX_BYTES = 16 * 1024 * 1024


def digest(data):
    return '0x' + hashlib.sha256(data).hexdigest()


def encode(arrays, metadata=None):
    entries, pieces = [], []
    for name, value in arrays.items():
        array = np.ascontiguousarray(value)
        if array.dtype not in (np.dtype('<f4'), np.dtype('<i8')):
            raise ValueError('Only float32 and int64 tensors are supported')
        entries.append({'name': name, 'dtype': array.dtype.str, 'shape': list(array.shape)})
        pieces.append(array.tobytes())
    header = json.dumps({'arrays': entries, 'metadata': metadata or {}}, separators=(',', ':')).encode()
    frame = struct.pack('!I', len(header)) + header + b''.join(pieces)
    if len(header) > 4096 or len(frame) > MAX_BYTES:
        raise ValueError('Frame exceeds size limit')
    return frame


def decode(frame):
    if len(frame) < 4 or len(frame) > MAX_BYTES:
        raise ValueError('Invalid frame size')
    size = struct.unpack('!I', frame[:4])[0]
    if size > 4096 or 4 + size > len(frame):
        raise ValueError('Invalid header size')
    header = json.loads(frame[4:4 + size])
    arrays, offset = {}, 4 + size
    entries = header['arrays']
    if not isinstance(entries, list) or len(entries) > 4:
        raise ValueError('Invalid tensor count')
    for entry in entries:
        name, dtype, shape = entry['name'], entry['dtype'], entry['shape']
        if name not in {'ids', 'mask', 'hidden', 'embedding'} or name in arrays:
            raise ValueError('Invalid tensor name')
        if dtype not in {'<f4', '<i8'} or not 1 <= len(shape) <= 3:
            raise ValueError('Invalid tensor specification')
        if any(type(d) is not int or not 1 <= d <= 384 for d in shape):
            raise ValueError('Invalid dimensions')
        count = int(np.prod(shape))
        length = count * np.dtype(dtype).itemsize
        if offset + length > len(frame):
            raise ValueError('Truncated tensor')
        value = np.frombuffer(frame, dtype=dtype, count=count, offset=offset).reshape(shape).copy()
        if not np.isfinite(value).all():
            raise ValueError('Nonfinite tensor')
        arrays[name] = value
        offset += length
    if offset != len(frame):
        raise ValueError('Trailing bytes')
    return arrays, header['metadata']


def configure():
    torch.set_num_threads(1)
    torch.set_grad_enabled(False)


def load_model(local_only=False):
    return AutoModel.from_pretrained(MODEL, revision=REVISION, use_safetensors=True,
                                    trust_remote_code=False, local_files_only=local_only,
                                    attn_implementation='eager').eval()


def pool(hidden, mask):
    mask = mask.unsqueeze(-1).to(hidden.dtype)
    return torch.nn.functional.normalize((hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9), p=2, dim=1)


def validate_input(arrays, stage):
    expected = {'ids', 'mask'} if stage == 0 else {'hidden', 'mask'}
    if set(arrays) != expected:
        raise ValueError('Wrong stage tensors')
    mask = arrays['mask']
    if mask.dtype != np.int64 or mask.ndim != 2 or not 1 <= mask.shape[0] <= 8 or not 1 <= mask.shape[1] <= 256:
        raise ValueError('Invalid attention mask shape')
    if not np.isin(mask, [0, 1]).all() or not (mask.sum(1) > 0).all():
        raise ValueError('Invalid attention mask values')
    if stage == 0:
        ids = arrays['ids']
        if ids.dtype != np.int64 or ids.shape != mask.shape or (ids < 0).any() or (ids >= 30522).any():
            raise ValueError('Invalid token IDs')
    elif arrays['hidden'].dtype != np.float32 or arrays['hidden'].shape != (*mask.shape, 384):
        raise ValueError('Invalid hidden states')


def worker_main(connection, stage):
    try:
        configure()
        model = load_model(local_only=True)
        layers = torch.nn.ModuleList(list(model.encoder.layer[:3] if stage == 0 else model.encoder.layer[3:]))
        embeddings = model.embeddings if stage == 0 else None
        del model
        parameters = sum(p.numel() for p in layers.parameters())
        if embeddings is not None:
            parameters += sum(p.numel() for p in embeddings.parameters())
        connection.send_bytes(encode({}, {'ready': True, 'pid': os.getpid(), 'parameters': parameters}))
        while True:
            incoming = connection.recv_bytes(MAX_BYTES)
            start = time.perf_counter()
            arrays, meta = decode(incoming)
            decode_ms = (time.perf_counter() - start) * 1000
            if meta.get('stop'):
                break
            if meta.get('fault') == 'crash':
                os._exit(17)
            if meta.get('fault') == 'stall':
                time.sleep(30)
            validate_input(arrays, stage)
            start = time.perf_counter()
            with torch.inference_mode():
                mask = torch.from_numpy(arrays['mask'])
                hidden = embeddings(input_ids=torch.from_numpy(arrays['ids'])) if stage == 0 else torch.from_numpy(arrays['hidden'])
                attention_mask = (1.0 - mask[:, None, None, :].float()) * torch.finfo(torch.float32).min
                for layer in layers:
                    hidden = layer(hidden, attention_mask=attention_mask)[0]
                output = {'hidden': hidden.numpy(), 'mask': arrays['mask']} if stage == 0 else {'embedding': pool(hidden, mask).numpy()}
            compute_ms = (time.perf_counter() - start) * 1000
            start = time.perf_counter()
            # Tensor payload is timed separately from the small metrics envelope.
            payload = encode(output)
            encode_ms = (time.perf_counter() - start) * 1000
            connection.send_bytes(encode({}, {'request_id': meta['request_id'], 'decode_ms': decode_ms,
                                            'compute_ms': compute_ms, 'encode_ms': encode_ms,
                                            'input_hash': digest(encode(arrays)), 'output_hash': digest(payload)}))
            connection.send_bytes(payload)
    except EOFError:
        pass
    except (ValueError, KeyError, TypeError, RuntimeError, OSError) as error:
        try:
            connection.send_bytes(encode({}, {'error': type(error).__name__ + ': ' + str(error)}))
        except (BrokenPipeError, OSError):
            pass
    finally:
        connection.close()


class Worker:
    def __init__(self, stage):
        context = mp.get_context('spawn')
        self.connection, child = context.Pipe()
        self.process = context.Process(target=worker_main, args=(child, stage), daemon=True)
        self.process.start()
        child.close()
        try:
            self.info = decode(self.receive(120))[1]
            if not self.info.get('ready'):
                raise RuntimeError(str(self.info))
        except Exception:
            self.close()
            raise

    def receive(self, timeout):
        if not self.connection.poll(timeout):
            raise TimeoutError('Worker response deadline exceeded')
        try:
            return self.connection.recv_bytes(MAX_BYTES)
        except (EOFError, OSError) as error:
            raise RuntimeError('Worker disconnected') from error

    def run(self, arrays, request_id, fault=None, timeout=10):
        start = time.perf_counter()
        frame = encode(arrays, {'request_id': request_id, 'fault': fault})
        encode_ms = (time.perf_counter() - start) * 1000
        started = time.perf_counter()
        self.connection.send_bytes(frame)
        deadline = started + timeout
        envelope = self.receive(timeout)
        metrics = decode(envelope)[1]
        if 'error' in metrics:
            raise RuntimeError(metrics['error'])
        if metrics.get('request_id') != request_id:
            raise RuntimeError('Worker request identity mismatch')
        payload = self.receive(max(0, deadline - time.perf_counter()))
        if metrics['output_hash'] != digest(payload) or metrics['input_hash'] != digest(encode(arrays)):
            raise RuntimeError('Worker payload hash mismatch')
        start = time.perf_counter()
        output = decode(payload)[0]
        metrics['parent_decode_ms'] = (time.perf_counter() - start) * 1000
        metrics['parent_encode_ms'] = encode_ms
        metrics['wire_bytes'] = len(frame) + len(envelope) + len(payload)
        return output, metrics

    def close(self):
        self.connection.close()
        if self.process.is_alive():
            self.process.terminate()
        self.process.join(timeout=5)


class Session:
    def __init__(self):
        configure()
        started = time.perf_counter()
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, trust_remote_code=False)
        self.model = load_model()
        self.workers = []
        try:
            self.workers = [Worker(0)]
            self.workers.append(Worker(1))
        except Exception:
            self.close()
            raise
        self.startup_ms = (time.perf_counter() - started) * 1000

    def prepare(self, texts):
        if not isinstance(texts, list) or not 1 <= len(texts) <= 8 or any(not isinstance(s, str) or not 1 <= len(s) <= 20000 for s in texts):
            raise ValueError('Expected 1..8 bounded nonempty strings')
        started = time.perf_counter()
        encoded = self.tokenizer(texts, padding=True, truncation=True, max_length=256, return_tensors='np')
        arrays = {'ids': encoded['input_ids'].astype('<i8'), 'mask': encoded['attention_mask'].astype('<i8')}
        return arrays, (time.perf_counter() - started) * 1000

    def local(self, arrays):
        started = time.perf_counter()
        with torch.inference_mode():
            mask = torch.from_numpy(arrays['mask'])
            hidden = self.model(input_ids=torch.from_numpy(arrays['ids']), attention_mask=mask).last_hidden_state
            embedding = pool(hidden, mask).numpy()
        return {'embedding': embedding.tolist(), 'local_compute_ms': (time.perf_counter() - started) * 1000}

    def split(self, arrays, request_id):
        started = time.perf_counter()
        hidden, first = self.workers[0].run(arrays, request_id)
        result, second = self.workers[1].run(hidden, request_id)
        wall = (time.perf_counter() - started) * 1000
        if first['output_hash'] != second['input_hash']:
            raise RuntimeError('Stage linkage mismatch')
        return {'embedding': result['embedding'].tolist(), 'split_wall_ms': wall,
                'stages': [first, second],
                'serialization_ms': sum(r[k] for r in [first, second] for k in ['decode_ms', 'encode_ms', 'parent_decode_ms', 'parent_encode_ms']),
                'wire_bytes': first['wire_bytes'] + second['wire_bytes']}

    def close(self):
        for worker in self.workers:
            worker.close()
