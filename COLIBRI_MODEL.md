# Getting the colibri model weights

The `colibri` submodule is an engine for running large MoE language models
from disk; it does not ship the model weights themselves — those are
downloaded separately, and are large (the reference model alone is **372 GB**).
This session's disk allowance (a few tens of GB) is far too small to hold
that download, so nothing was fetched here. Steps below are for running on
your own machine with enough free disk.

## Reference model: GLM-5.2 (int4, gs64, int8 MTP head)

Pre-converted container on Hugging Face, ~372 GB:

**https://huggingface.co/mastouri/GLM-5.2-colibri-int4-g64-with-int8-mtp**

Use the **gs64** container linked above, not the older per-row int4 mirrors
(`mateogrgic/…`, `jlnsrk/…`) — those measure worse on quality. The MTP head
must be **int8**, not int4 (int4 gives 0% draft acceptance). Verify with:

```bash
ls -l <model>/out-mtp-*   # int8 (correct): 3527131672 / 5366238584 / 1065950496
```

Requirements: 16 GB RAM minimum (24 GB comfortable), no GPU needed. Disk
speed sets decode speed, since experts stream from disk.

### Or convert from source yourself

One resumable command, shard by shard, that never needs the full 756 GB
source on disk at once:

```bash
./coli convert --model /nvme/glm52_i4
```

## Running it

From inside `colibri/`:

```bash
mkdir colibri-release && tar xzf colibri-v1.8.0-linux-x86_64.tar.gz -C colibri-release
cd colibri-release && python3 coli info      # confirm the engine is ready

COLI_MODEL=/path/to/glm52_i4 ./coli chat
```

Full details, other supported model families (Inkling, GLM-5.3-Flash,
Kimi K3, DeepSeek V4, Qwen3.6/3.8, OLMoE), and the quick-start guide are in
[`colibri/README.md`](colibri/README.md#get-started) and
[`colibri/docs/quickstart.md`](colibri/docs/quickstart.md).
