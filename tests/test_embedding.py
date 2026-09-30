import json
import time
from pathlib import Path

import numpy as np
import pytest

from benchmark.runtime import Session, Worker, decode, encode, validate_input


@pytest.fixture(scope='module')
def session():
    value = Session()
    yield value
    value.close()


def test_codec_roundtrip_without_pickle():
    arrays = {'hidden': np.arange(24, dtype='<f4').reshape(2, 3, 4), 'mask': np.ones((2, 3), dtype='<i8')}
    decoded, metadata = decode(encode(arrays, {'request_id': 'fixture'}))
    assert metadata['request_id'] == 'fixture'
    for name, value in arrays.items():
        np.testing.assert_array_equal(decoded[name], value)


@pytest.mark.parametrize('frame', [b'', b'\x00\x00\x10\x01', encode({'mask': np.ones((1, 2), dtype='<i8')})[:-1], encode({}) + b'x', encode({'hidden': np.array([float('nan')], dtype='<f4')})])
def test_codec_rejects_malformed_frames(frame):
    with pytest.raises((ValueError, KeyError)):
        decode(frame)


@pytest.mark.parametrize('name', ['single-short', 'batch-four', 'batch-two-long'])
def test_trained_embeddings_match_and_normalize(session, name):
    cases = json.loads(Path('benchmark/workloads.json').read_text())['cases']
    arrays, _ = session.prepare(next(c['texts'] for c in cases if c['name'] == name))
    local = np.array(session.local(arrays)['embedding'])
    split = session.split(arrays, name)
    np.testing.assert_allclose(split['embedding'], local, atol=1e-5, rtol=1e-5)
    np.testing.assert_allclose(np.linalg.norm(local, axis=1), 1, atol=1e-6)
    assert split['stages'][0]['output_hash'] == split['stages'][1]['input_hash']
    assert session.workers[0].info['pid'] != session.workers[1].info['pid']


def test_padding_does_not_change_embedding(session):
    single, _ = session.prepare(['A cat sits on a mat.'])
    padded, _ = session.prepare(['A cat sits on a mat.', 'This much longer sentence describes how different token sequence lengths introduce padding into a batch.'])
    np.testing.assert_allclose(session.split(single, 'single')['embedding'][0], session.split(padded, 'padded')['embedding'][0], atol=1e-5, rtol=1e-5)


def test_invalid_stage_inputs():
    with pytest.raises(ValueError):
        validate_input({'ids': np.array([[40000]], dtype='<i8'), 'mask': np.ones((1, 1), dtype='<i8')}, 0)
    with pytest.raises(ValueError):
        validate_input({'ids': np.array([[1]], dtype='<i8'), 'mask': np.zeros((1, 1), dtype='<i8')}, 0)


@pytest.mark.parametrize('fault,expected', [('crash', RuntimeError), ('stall', TimeoutError)])
def test_failed_worker_is_bounded_and_not_silently_retried(session, fault, expected):
    worker = Worker(0)
    arrays, _ = session.prepare(['Public failure injection fixture.'])
    try:
        started = time.perf_counter()
        with pytest.raises(expected):
            worker.run(arrays, 'fault', fault=fault, timeout=0.5)
        assert time.perf_counter() - started < 5
    finally:
        worker.close()
