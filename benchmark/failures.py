"""Record controlled local failure observations; not adversarial verification."""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from benchmark.runtime import Session, Worker


def main():
    session = Session()
    records = []
    try:
        arrays, _ = session.prepare(['Public failure-injection workload.'])
        for fault, expected in [('crash', RuntimeError), ('stall', TimeoutError)]:
            worker = Worker(0)
            try:
                started = time.perf_counter()
                try:
                    worker.run(arrays, fault, fault=fault, timeout=0.5)
                except expected as error:
                    records.append({'scenario': fault, 'detected': True,
                                    'detection_ms': (time.perf_counter() - started) * 1000,
                                    'error': str(error), 'retries': 0})
                else:
                    raise AssertionError('Injected failure went undetected')
            finally:
                worker.close()
        worker = Worker(0)
        try:
            invalid = {k: v.copy() for k, v in arrays.items()}
            invalid['ids'][0, 0] = 40000
            started = time.perf_counter()
            try:
                worker.run(invalid, 'invalid-token')
            except RuntimeError as error:
                records.append({'scenario': 'invalid_token_id', 'detected': True,
                                'detection_ms': (time.perf_counter() - started) * 1000,
                                'error': str(error), 'retries': 0})
            else:
                raise AssertionError('Invalid input was accepted')
        finally:
            worker.close()
    finally:
        session.close()
    report = {'generated_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'One observation per injected local fault. No availability estimate, automatic recovery or cryptographic verification.',
              'deadline_ms': 500, 'records': records}
    Path('evaluation').mkdir(exist_ok=True)
    Path('evaluation/failures.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for record in records:
        print(f"{record['scenario']}: detected after {record['detection_ms']:.2f} ms; no retries")


if __name__ == '__main__':
    main()
