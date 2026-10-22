# genenet

A small Python client for a GeneNet installation. Standard library only, so it
drops into an analysis environment without installing anything.

```python
from genenet import GeneNet

lab = GeneNet("https://genenet.example.org", token="gnt_…")

for sample in lab.samples.all(q="pEGFP"):
    print(sample["sampleId"], sample["name"])

oligo = lab.oligos.create(name="M13 fwd", sequence="GTAAAACGACGGCCAGT")
print(oligo["code"])        # OLI-014, issued by the server
```

A token is made under Settings → API tokens, and carries either read or write
permission. The resources are `samples`, `sequences`, `oligos`, `plates`,
`requests`, `reads`, `procedures`, `projects`, `tasks` and `freezers`.

`list()` returns one page; `all()` is a generator over every match, because
"every sample in the freezer" is a reasonable thing to ask for and an
unreasonable thing to hold in memory at once.

## Checking a webhook

```python
from genenet import verify_signature

if not verify_signature(request.body, request.headers["X-GeneNet-Signature"], SECRET):
    return 400
```

Pass the **exact bytes** that arrived. Parsing the JSON and re-serialising it
changes the whitespace, and the signature will not match — which is the usual
reason a first attempt at this fails.

The signature is `t=<unix seconds>,v1=<hmac-sha256>` over `"<t>.<body>"`. The
timestamp is inside the signed string, so an old capture cannot be replayed;
deliveries more than five minutes old are rejected by default.
