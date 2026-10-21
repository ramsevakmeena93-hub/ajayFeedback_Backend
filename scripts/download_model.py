import os
import requests
import sys
import time

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

MODEL_ID = "MoritzLaurer/deberta-v3-base-zeroshot-v1"
BASE_URL = f"https://huggingface.co/{MODEL_ID}/resolve/main"

FILES = [
    "config.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "spm.model",
    "tokenizer.json",
    "model.safetensors"
]

def download_file_resilient(filename, output_dir, max_retries=100):
    dest_path = os.path.join(output_dir, filename)
    url = f"{BASE_URL}/{filename}"

    session = requests.Session()
    total_bytes = None
    try:
        head_resp = session.head(url, allow_redirects=True, timeout=30)
        if head_resp.status_code == 200:
            total_bytes = int(head_resp.headers.get("Content-Length", 0))
    except Exception as e:
        print(f"HEAD request failed: {e}")

    retries = 0
    while retries < max_retries:
        downloaded_bytes = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0

        if total_bytes and downloaded_bytes >= total_bytes:
            print(f"[OK] {filename} is already fully downloaded ({downloaded_bytes / (1024*1024):.2f} MB).")
            return dest_path

        headers = {}
        if downloaded_bytes > 0:
            headers["Range"] = f"bytes={downloaded_bytes}-"
            print(f"Resuming {filename} from {downloaded_bytes / (1024*1024):.2f} MB...")
        else:
            print(f"Starting download of {filename}...")

        try:
            with session.get(url, headers=headers, stream=True, timeout=30, allow_redirects=True) as response:
                if response.status_code == 416: # Range not satisfiable (file already complete)
                    print(f"[OK] {filename} is fully downloaded.")
                    return dest_path

                if response.status_code not in (200, 206):
                    if response.status_code == 404:
                        print(f"- {filename} not found (404), skipping.")
                        return None
                    raise RuntimeError(f"HTTP {response.status_code}")

                if not total_bytes:
                    content_len = int(response.headers.get("Content-Length", 0))
                    total_bytes = (downloaded_bytes + content_len) if response.status_code == 206 else content_len

                mode = "ab" if downloaded_bytes > 0 and response.status_code == 206 else "wb"
                if mode == "wb":
                    downloaded_bytes = 0

                chunk_size = 1024 * 512 # 512KB
                last_log = downloaded_bytes

                with open(dest_path, mode) as f:
                    for chunk in response.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                            f.flush()
                            downloaded_bytes += len(chunk)
                            if downloaded_bytes - last_log >= 5 * 1024 * 1024:
                                last_log = downloaded_bytes
                                pct = (downloaded_bytes / total_bytes * 100) if total_bytes else 0
                                print(f"  [{filename}] {downloaded_bytes / (1024*1024):.1f}/{total_bytes / (1024*1024):.1f} MB ({pct:.1f}%)", flush=True)

            current_size = os.path.getsize(dest_path)
            if total_bytes and current_size >= total_bytes:
                print(f"[OK] Completed {filename} ({current_size / (1024*1024):.2f} MB)!\n", flush=True)
                return dest_path

        except Exception as e:
            retries += 1
            print(f"  Connection dropped ({e}). Retry {retries}/{max_retries} in 2s...", flush=True)
            time.sleep(2)

    raise RuntimeError(f"Exceeded max retries for {filename}")

if __name__ == "__main__":
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "deberta-zeroshot"))
    os.makedirs(out_dir, exist_ok=True)
    print(f"Downloading model to: {out_dir}\n", flush=True)
    for f in FILES:
        download_file_resilient(f, out_dir)
    print("\nALL FILES DOWNLOADED SUCCESSFULLY!", flush=True)
