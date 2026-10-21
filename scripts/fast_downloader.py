import os
import sys
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

MODEL_ID = "MoritzLaurer/deberta-v3-base-zeroshot-v1"
FILE_URL = f"https://huggingface.co/{MODEL_ID}/resolve/main/model.safetensors"
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "deberta-zeroshot"))
DEST_FILE = os.path.join(OUT_DIR, "model.safetensors")

TOTAL_SIZE = 368871908
NUM_WORKERS = 8

write_lock = threading.Lock()
downloaded_in_session = 0
total_downloaded = 0
session_start_time = time.time()

def download_range(part_idx, start_byte, end_byte):
    global downloaded_in_session, total_downloaded
    expected_bytes = end_byte - start_byte + 1
    current_offset = start_byte

    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(max_retries=5)
    session.mount('https://', adapter)

    retries = 0
    max_retries = 20

    while current_offset <= end_byte and retries < max_retries:
        headers = {"Range": f"bytes={current_offset}-{end_byte}"}
        try:
            with session.get(FILE_URL, headers=headers, stream=True, timeout=30, allow_redirects=True) as resp:
                if resp.status_code not in (200, 206):
                    raise RuntimeError(f"Part {part_idx} returned HTTP {resp.status_code}")

                with open(DEST_FILE, "r+b") as f:
                    for chunk in resp.iter_content(chunk_size=1024 * 256):
                        if chunk:
                            with write_lock:
                                f.seek(current_offset)
                                f.write(chunk)
                                f.flush()
                                downloaded_in_session += len(chunk)
                                total_downloaded += len(chunk)
                            current_offset += len(chunk)

            if current_offset > end_byte:
                return True
        except Exception as e:
            retries += 1
            time.sleep(1)

    if current_offset <= end_byte:
        raise RuntimeError(f"Part {part_idx} failed after {max_retries} retries")
    return True

def progress_reporter(total_target):
    while total_downloaded < total_target:
        elapsed = time.time() - session_start_time
        speed_kb = (downloaded_in_session / 1024 / elapsed) if elapsed > 0 else 0
        pct = (total_downloaded / total_target) * 100
        mb_done = total_downloaded / (1024 * 1024)
        mb_total = total_target / (1024 * 1024)
        print(f"Progress: {mb_done:.1f}/{mb_total:.1f} MB ({pct:.1f}%) | Speed: {speed_kb:.1f} KB/s", flush=True)
        time.sleep(3)

def main():
    global total_downloaded
    os.makedirs(OUT_DIR, exist_ok=True)

    current_size = os.path.getsize(DEST_FILE) if os.path.exists(DEST_FILE) else 0
    if current_size >= TOTAL_SIZE:
        print(f"[OK] model.safetensors is already complete ({current_size / (1024*1024):.2f} MB).")
        return

    print(f"Current file size: {current_size / (1024*1024):.2f} MB / {TOTAL_SIZE / (1024*1024):.2f} MB")
    
    # Pre-allocate full size if needed
    with open(DEST_FILE, "a+b") as f:
        f.truncate(TOTAL_SIZE)

    total_downloaded = current_size
    remaining_bytes = TOTAL_SIZE - current_size
    print(f"Downloading remaining {remaining_bytes / (1024*1024):.2f} MB using {NUM_WORKERS} parallel threads...")

    chunk_size = remaining_bytes // NUM_WORKERS
    parts = []
    for i in range(NUM_WORKERS):
        p_start = current_size + i * chunk_size
        p_end = (current_size + (i + 1) * chunk_size - 1) if i < NUM_WORKERS - 1 else (TOTAL_SIZE - 1)
        parts.append((i, p_start, p_end))

    # Start progress reporter
    reporter_thread = threading.Thread(target=progress_reporter, args=(TOTAL_SIZE,), daemon=True)
    reporter_thread.start()

    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
        futures = [executor.submit(download_range, idx, start, end) for idx, start, end in parts]
        for f in as_completed(futures):
            f.result()

    print(f"\n[OK] model.safetensors download complete ({TOTAL_SIZE / (1024*1024):.2f} MB)!")

if __name__ == "__main__":
    main()
