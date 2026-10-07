"""Decodes Antigravity CLI conversation SQLite files (protobuf blobs) into JSON usage rows.
Usage: python3 decode-conversations.py <file.db> [<file.db> ...]   -> JSON on stdout
No protobuf schema is available; the wire format is walked raw and the field numbers below were
verified against `agy -p --output-format json` usage output on 2026-09-03.
"""
import json, os, re, sqlite3, sys


def varint(b, i):
    r = 0; s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if not c & 0x80:
            return r, i


def fields(b):
    out = {}
    def rec(b, path):
        i = 0
        while i < len(b):
            key, i = varint(b, i); f = key >> 3; wt = key & 7; p = f"{path}{f}"
            if wt == 0:
                v, i = varint(b, i); out.setdefault(p, v)
            elif wt == 1:
                i += 8
            elif wt == 5:
                i += 4
            elif wt == 2:
                l, i = varint(b, i); s = b[i:i + l]; i += l
                try:
                    t = s.decode("utf-8")
                    if t.isprintable():
                        out.setdefault(p, t); continue
                except Exception:
                    pass
                try:
                    rec(s, p + ".")
                except Exception:
                    pass
            else:
                return
    try:
        rec(b, "")
    except Exception:
        pass
    return out


def ts_of(meta):
    sec = meta.get("1.1"); nanos = meta.get("1.2", 0)
    if isinstance(sec, int) and sec > 1_000_000_000:
        from datetime import datetime, timezone
        return datetime.fromtimestamp(sec + (nanos / 1e9 if isinstance(nanos, int) else 0), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    return None


def decode(path):
    cid = os.path.basename(path)[:-3]
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    row = db.execute("select data from trajectory_metadata_blob").fetchone()
    meta = fields(row[0]) if row and row[0] else {}
    workspace = meta.get("1.1") or meta.get("7")
    parent = meta.get("5")
    agent = meta.get("8.2")
    steps = db.execute("select idx, step_type, metadata, step_payload from steps order by idx").fetchall()
    gen_steps = [s for s in steps if s[1] == 15]
    first_prompt = ""
    for idx, st, md, payload in steps:
        if st == 14 and payload:
            first_prompt = re.sub(r"[^\x09\x0a\x0d\x20-\x7e]", " ", payload.decode("utf-8", "ignore"))[:40000]
            break
    last_ts = None
    for _, _, md, _ in steps:
        t = ts_of(fields(md)) if md else None
        if t: last_ts = t
    gens = []
    for k, (idx, data, size) in enumerate(db.execute("select idx, data, size from gen_metadata order by idx")):
        d = fields(data)
        usage = {k2: d[k2] for k2 in d if k2.startswith("1.4.")}
        step = gen_steps[k] if k < len(gen_steps) else None
        ts = ts_of(fields(step[2])) if step and step[2] else None
        gens.append({
            "idx": idx,
            "genId": usage.get("1.4.11"),
            "model": d.get("1.19"),
            "inputTokens": usage.get("1.4.2", 0),
            "cacheReadTokens": usage.get("1.4.5", 0),
            "outputTokens": usage.get("1.4.3", 0),
            "thinkingTokens": usage.get("1.4.9", 0),
            "timestamp": ts or last_ts,
        })
    return {
        "id": cid,
        "workspace": workspace.replace("file://", "") if isinstance(workspace, str) else None,
        "parentId": parent if parent and parent != cid else None,
        "agentName": agent,
        "startedAt": ts_of(fields(steps[0][2])) if steps and steps[0][2] else None,
        "updatedAt": last_ts,
        "firstPrompt": first_prompt,
        "generations": gens,
    }


sys.stdout.write(json.dumps([decode(p) for p in sys.argv[1:]]))
