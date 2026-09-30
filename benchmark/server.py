"""Local JSON-lines controller for the Node benchmark; stdout is protocol only."""
import json
import platform
import sys

import torch
import transformers

from benchmark.runtime import MODEL, REVISION, Session, digest, encode


def main():
    session = Session()
    prepared = {}
    def emit(value):
        print(json.dumps(value, allow_nan=False), flush=True)
    try:
        emit({'ready': True, 'model': MODEL, 'revision': REVISION, 'workers': [w.info for w in session.workers],
              'startup_ms': session.startup_ms, 'python': platform.python_version(), 'torch': torch.__version__,
              'transformers': transformers.__version__, 'platform': platform.platform(),
              'processor': platform.processor(), 'threads_per_process': torch.get_num_threads()})
        for line in sys.stdin:
            if len(line) > 200000:
                raise ValueError('Oversized control message')
            request = json.loads(line)
            action = request['action']
            if action == 'stop':
                break
            key = request['case']
            if action == 'prepare':
                arrays, ms = session.prepare(request['texts'])
                prepared[key] = arrays
                emit({'input_hash': digest(encode(arrays)), 'shape': list(arrays['ids'].shape), 'tokenization_ms': ms})
            elif action == 'local':
                emit(session.local(prepared[key]))
            elif action == 'split':
                emit(session.split(prepared[key], request['request_id']))
            else:
                raise ValueError('Unknown action')
    finally:
        session.close()


if __name__ == '__main__':
    main()
