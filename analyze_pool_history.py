import sqlite3
import os
import numpy as np

DB_PATH = os.path.join(os.path.dirname(__file__), 'pool_history.sqlite')
FIVE_MIN = 5 * 60  # 5 minutes in seconds

def analyze_first_5min():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT DISTINCT pool_id FROM pool_history")
    pool_ids = [row[0] for row in c.fetchall()]

    time_buckets = list(range(0, FIVE_MIN+1, 30))  # every 30 seconds
    bucket_results = {t: {'profitable': 0, 'not_profitable': 0} for t in time_buckets}
    pools_classification_time = []

    for pool_id in pool_ids:
        c.execute("SELECT timestamp, price FROM pool_history WHERE pool_id=? ORDER BY timestamp ASC", (pool_id,))
        rows = c.fetchall()
        if len(rows) < 2:
            continue
        timestamps, prices = zip(*rows)
        start_time, start_price = timestamps[0], prices[0]
        # Normalize times to seconds since pool start
        rel_times = [t - start_time for t in timestamps]
        # Only consider first 5 minutes
        within_5min = [(t, p) for t, p in zip(rel_times, prices) if t <= FIVE_MIN]
        if not within_5min:
            continue
        times_5min, prices_5min = zip(*within_5min)
        ever_profitable = [p > start_price for p in prices_5min]
        ever_nonprofitable = [p <= start_price for p in prices_5min]

        # For each bucket, check if pool is profitable at that time
        for t in time_buckets:
            idx = next((i for i, time in enumerate(times_5min) if time >= t), -1)
            if idx == -1:
                continue
            price = prices_5min[idx]
            if price > start_price:
                bucket_results[t]['profitable'] += 1
            else:
                bucket_results[t]['not_profitable'] += 1

        # Find the earliest time after which the pool never switches profitability state
        last_state = None
        switch_time = None
        for t, p in zip(times_5min, prices_5min):
            state = p > start_price
            if last_state is not None and state != last_state:
                switch_time = t
            last_state = state
        pools_classification_time.append(switch_time if switch_time is not None else 0)

    print("Profitable pool counts at each time bucket in first 5min:")
    for t in time_buckets:
        print(f"{t//60}:{t%60:02d} - Profitable: {bucket_results[t]['profitable']}, Not Profitable: {bucket_results[t]['not_profitable']}")

    avg_classification_time = np.mean([t for t in pools_classification_time if t is not None])
    print(f"\nAverage time until pools 'lock in' their winner/loser state: {avg_classification_time/60:.2f} minutes")

if __name__ == "__main__":
    analyze_first_5min()
