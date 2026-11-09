#!/usr/bin/env python3
"""Validate one built-in draw.io template file.

Checks the structural contract the plugin's test suite enforces:
- a bare `<mxGraphModel>` document with no comments/DTD;
- unique cell ids, valid edge endpoints, explicit vertex geometry;
- Chinese labels (the catalog is for Chinese-speaking users);
- no overlapping sibling shapes (text/swimlane/image/note/line overlays excepted).

Usage: python3 scripts/check-template.py <file.drawio>
Exit code 0 when clean, 1 with a problem list otherwise (plus a short summary).
"""
import re
import sys
import xml.etree.ElementTree as ET

OVERLAY = re.compile(r"(^|;)text(;|$)|swimlane|shape=image|shape=line|shape=note|dashed=1")
ID = re.compile(r"^[A-Za-z0-9_.:-]+$")
CJK = re.compile(r"[\u4e00-\u9fff]")


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-template.py <file.drawio>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    problems = []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as error:
        print(f"FAIL {path}: cannot read ({error})")
        return 1

    if len(raw.encode("utf-8")) < 200:
        problems.append("file is too small to be a diagram")
    if len(raw.encode("utf-8")) > 512 * 1024:
        problems.append("file is larger than 512 KB")
    if "<!--" in raw:
        problems.append("XML comments are not allowed")
    if re.search(r"<!doctype|<!entity", raw, re.IGNORECASE):
        problems.append("DOCTYPE/ENTITY declarations are not allowed")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        print(f"FAIL {path}: XML does not parse: {error}")
        return 1
    if root.tag != "mxGraphModel":
        problems.append(f"root element must be <mxGraphModel>, found <{root.tag}>")

    cells = [cell for cell in root.iter("mxCell")]
    by_id = {}
    for cell in cells:
        cell_id = cell.get("id")
        if cell_id is None:
            problems.append("a cell has no id")
            continue
        if cell_id in by_id:
            problems.append(f"duplicate cell id {cell_id!r}")
        by_id[cell_id] = cell

    vertices = {cid: cell for cid, cell in by_id.items() if cell.get("vertex") == "1"}
    edges = {cid: cell for cid, cell in by_id.items() if cell.get("edge") == "1"}
    if len(vertices) < 4:
        problems.append(f"needs at least 4 nodes, found {len(vertices)}")
    if len(edges) < 2:
        problems.append(f"needs at least 2 edges, found {len(edges)}")

    cjk_labels = 0
    boxes = {}
    for cell_id, cell in vertices.items():
        label = cell.get("value") or ""
        style = cell.get("style") or ""
        if CJK.search(label):
            cjk_labels += 1
        geometry = cell.find("mxGeometry")
        if geometry is None:
            problems.append(f"node {cell_id!r} has no mxGeometry")
            continue
        rect = [num(geometry.get(key)) for key in ("x", "y", "width", "height")]
        if any(value is None for value in rect):
            problems.append(f"node {cell_id!r} needs numeric x/y/width/height")
            continue
        if not OVERLAY.search(style):
            boxes[cell_id] = rect
        for value in rect:
            if abs(value) > 8000:
                problems.append(f"node {cell_id!r} is far outside the canvas ({rect})")
                break

    for cell_id, cell in edges.items():
        for attribute in ("source", "target"):
            endpoint = cell.get(attribute)
            if endpoint is None:
                problems.append(f"edge {cell_id!r} has no {attribute}")
            elif endpoint not in by_id:
                problems.append(f"edge {cell_id!r} {attribute} {endpoint!r} does not exist")
            elif endpoint not in vertices:
                problems.append(f"edge {cell_id!r} {attribute} {endpoint!r} is not a node")

    groups = {}
    for cell_id, rect in boxes.items():
        parent = by_id[cell_id].get("parent", "1")
        groups.setdefault(parent, []).append((cell_id, rect))
    for parent, members in groups.items():
        for left in range(len(members)):
            for right in range(left + 1, len(members)):
                first_id, first = members[left]
                second_id, second = members[right]
                overlap_x = min(first[0] + first[2], second[0] + second[2]) - max(first[0], second[0])
                overlap_y = min(first[1] + first[3], second[1] + second[3]) - max(first[1], second[1])
                if overlap_x > 4 and overlap_y > 4:
                    problems.append(f"nodes {first_id!r} and {second_id!r} overlap (parent {parent})")

    if cjk_labels < 3:
        problems.append(f"needs at least 3 Chinese labels, found {cjk_labels}")

    if problems:
        print(f"FAIL {path}")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"OK {path}: {len(vertices)} nodes, {len(edges)} edges, {cjk_labels} Chinese labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
