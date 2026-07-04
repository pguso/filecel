---
"@filecel/r2": minor
---

Add upload-time transform pipeline for image resize (sharp) and video transcode (ffmpeg). Variants are stored as separate R2 objects with deterministic keys and returned in `UploadFromUrlResult.variants`.
