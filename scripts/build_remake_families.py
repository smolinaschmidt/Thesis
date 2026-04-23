"""
Infer remake families from data/Final_Database.csv and export review artifacts.

Uses Wikipedia "List of film remakes" tables under data/source/wikipedia/ when
present, unions each table row into one family component, then merges with
token-signature grouping. Always keeps The Great Gatsby, The Girl with the
Dragon Tattoo, and The Fly entries together (per franchise) even if missing
from Wikipedia.

Outputs:
  - data/analisis/movies_with_families.csv
  - data/analisis/movies_with_families.json
  - data/analisis/review/family_inference_review.csv
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / "data" / "Final_Database.csv"
WIKI_DIR = ROOT / "data" / "source" / "wikipedia"
PROCESSED_DIR = ROOT / "data" / "analisis"
REVIEW_DIR = ROOT / "data" / "analisis" / "review"

STOPWORDS = {"the", "a", "an", "movie", "film"}


@dataclass
class Movie:
    title: str
    year: int | None
    tmdb_link: str
    tmdb_id: int | None
    genres: list[str]
    normalized_title: str
    token_signature: str
    family_id: str = ""


def clean_title(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw).lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # remove leading article
    text = re.sub(r"^(the|a|an)\s+", "", text)
    return text


def title_signature(title: str) -> str:
    tokens = [token for token in clean_title(title).split() if token not in STOPWORDS]
    if not tokens:
        return ""
    # keep order-independent signature to improve matching variants
    return " ".join(sorted(tokens))


def parse_year(raw: str) -> int | None:
    if not raw:
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def parse_tmdb_id(link: str) -> int | None:
    if not link:
        return None
    match = re.search(r"/movie/(\d+)", link)
    if not match:
        return None
    return int(match.group(1))


def parse_genres(raw: str) -> list[str]:
    if not raw:
        return []
    return [piece.strip() for piece in raw.split(",") if piece.strip()]


def load_movies() -> list[Movie]:
    movies: list[Movie] = []
    with SOURCE_CSV.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            title = (row.get("Movie") or "").strip()
            if not title:
                continue
            movie = Movie(
                title=title,
                year=parse_year((row.get("Year") or "").strip()),
                tmdb_link=(row.get("TMDB_Link") or "").strip(),
                tmdb_id=parse_tmdb_id((row.get("TMDB_Link") or "").strip()),
                genres=parse_genres((row.get("Genre") or "").strip()),
                normalized_title=clean_title(title),
                token_signature=title_signature(title),
            )
            movies.append(movie)
    return movies


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(a=a, b=b).ratio()


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, x: int) -> int:
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def wiki_slug_normalized(link_inner: str) -> str | None:
    match = re.search(r"/wiki/([^)#]+)", link_inner)
    if not match:
        return None
    slug = unquote(match.group(1).replace("_", " "))
    slug = re.sub(r"\s+", " ", slug).strip()
    return clean_title(slug)


def slug_base_for_match(link_inner: str) -> str | None:
    """Slug text without trailing (YEAR film) disambiguation — closer to CSV titles."""
    raw = wiki_slug_normalized(link_inner)
    if not raw:
        return None
    s = re.sub(r"\s+(19|20)\d{2}(\s+film)?$", "", raw).strip()
    s = re.sub(r"\s+film$", "", s).strip()
    return s or raw


# Wikipedia release years vs TMDB sometimes differ by ±1 (premieres).
WIKI_YEAR_SLOP = 2
WIKI_MATCH_MIN_SCORE = 0.78
WIKI_MATCH_AMBIGUITY = 0.04

# "13 Ghosts" vs "Thirteen Ghosts" after normalization
_DIGIT_TO_WORD = {
    "10": "ten",
    "11": "eleven",
    "12": "twelve",
    "13": "thirteen",
    "14": "fourteen",
    "15": "fifteen",
    "16": "sixteen",
    "17": "seventeen",
    "18": "eighteen",
    "19": "nineteen",
    "20": "twenty",
}


def _spoken_number_variants(norm: str) -> list[str]:
    if not norm:
        return [norm]
    parts = norm.split()
    alt = " ".join(_DIGIT_TO_WORD.get(p, p) for p in parts)
    if alt == norm:
        return [norm]
    return [norm, alt]


def extract_titled_films(cell: str) -> list[tuple[str, str, int]]:
    """Parse wiki film cells: _[Title](URL optional quoted display)_ (YEAR).

    A naive [^)]+ link pattern breaks when the quoted display title contains parentheses.
    """
    out: list[tuple[str, str, int]] = []
    for m in re.finditer(r"_\[(?P<title>[^\]]*)\]\(", cell):
        title = (m.group("title") or "").strip()
        start_inner = m.end()
        depth = 1
        k = start_inner
        while k < len(cell) and depth > 0:
            ch = cell[k]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            k += 1
        if depth != 0:
            continue
        inner = cell[start_inner : k - 1].strip()
        tail = cell[k:].lstrip()
        if not tail.startswith("_"):
            continue
        year_m = re.match(r"_\s*\((\d{4})\)", tail)
        if not year_m:
            continue
        try:
            year = int(year_m.group(1))
        except ValueError:
            continue
        if title:
            out.append((title, inner, year))
    return out


ITALIC_TITLE_YEAR = re.compile(r"_([^_]+)_\s*\((\d{4})\)")


def extract_italic_year_films(cell: str) -> list[tuple[str, str, int]]:
    """Wikipedia often uses _Title_ (YEAR) without a markdown link — e.g. TV remakes."""
    out: list[tuple[str, str, int]] = []
    for m in ITALIC_TITLE_YEAR.finditer(cell):
        inner = (m.group(1) or "").strip()
        if not inner or inner.startswith("[") or "](" in inner:
            continue
        try:
            year = int(m.group(2))
        except ValueError:
            continue
        out.append((inner, "", year))
    return out


def films_from_wiki_cell(cell: str) -> list[tuple[str, str, int]]:
    merged = extract_titled_films(cell) + extract_italic_year_films(cell)
    dedup: list[tuple[str, str, int]] = []
    seen: set[tuple[str, int]] = set()
    for title, link, year in merged:
        key = (clean_title(title), year)
        if key in seen:
            continue
        seen.add(key)
        dedup.append((title, link, year))
    return dedup


def iter_wiki_table_rows(path: Path) -> Iterable[tuple[str, str]]:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        if re.match(r"^\|\s*[-:]+", line):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            continue
        original, remakes = parts[1], parts[2]
        if original.lower() == "original" and "remake" in remakes.lower():
            continue
        yield original, remakes


def match_movie_indices(movies: list[Movie], wiki_title: str, link: str, year: int) -> list[int]:
    """Map one Wikipedia film cell to CSV row(s), allowing small year drift and looser titles."""
    bracket_norm = clean_title(wiki_title)
    slug_base = slug_base_for_match(link) if "/wiki/" in link else None

    def title_score(m: Movie) -> float:
        mn = m.normalized_title
        scores: list[float] = []
        for bn in _spoken_number_variants(bracket_norm):
            scores.append(similarity(bn, mn))
            for mnv in _spoken_number_variants(mn):
                scores.append(similarity(bn, mnv))
        if slug_base:
            scores.append(similarity(slug_base, mn))
            if mn == slug_base:
                scores.append(1.0)
            for sbv in _spoken_number_variants(slug_base):
                scores.append(similarity(sbv, mn))
        if mn == bracket_norm:
            scores.append(1.0)
        return max(scores) if scores else 0.0

    pool: list[int] = []
    for i, m in enumerate(movies):
        if m.year is None:
            continue
        if abs(int(m.year) - int(year)) <= WIKI_YEAR_SLOP:
            pool.append(i)

    scored: list[tuple[float, int, int]] = []
    for i in pool:
        sc = title_score(movies[i])
        if sc < WIKI_MATCH_MIN_SCORE:
            continue
        yd = abs(int(movies[i].year) - int(year))  # type: ignore[arg-type]
        scored.append((sc, yd, i))

    if not scored:
        return []

    scored.sort(key=lambda t: (-t[0], t[1], t[2]))
    best_sc, _, best_i = scored[0]
    if len(scored) >= 2 and best_sc < 0.92:
        if scored[1][0] >= best_sc - WIKI_MATCH_AMBIGUITY:
            return []

    return [best_i]


def union_clique(uf: UnionFind, indices: list[int]) -> None:
    idxs = sorted(set(indices))
    if len(idxs) < 2:
        return
    first = idxs[0]
    for other in idxs[1:]:
        uf.union(first, other)


def merge_candidate(group_a: list[Movie], group_b: list[Movie]) -> bool:
    sample_a = group_a[0]
    sample_b = group_b[0]
    ratio = similarity(sample_a.token_signature, sample_b.token_signature)
    if ratio < 0.92:
        return False
    years = [movie.year for movie in (group_a + group_b) if movie.year]
    if len(years) < 2:
        return True
    return max(years) - min(years) <= 80


def merge_candidate_indices(movies: list[Movie], idxs_a: list[int], idxs_b: list[int]) -> bool:
    group_a = [movies[i] for i in idxs_a]
    group_b = [movies[i] for i in idxs_b]
    return merge_candidate(group_a, group_b)


def infer_signature_group_indices(movies: list[Movie]) -> list[list[int]]:
    signature_groups: dict[str, list[int]] = defaultdict(list)
    for idx, movie in enumerate(movies):
        key = movie.token_signature or movie.normalized_title
        signature_groups[key].append(idx)
    merged: list[list[int]] = []
    for _, idxs in signature_groups.items():
        attached = False
        for existing in merged:
            if merge_candidate_indices(movies, existing, idxs):
                existing.extend(idxs)
                attached = True
                break
        if not attached:
            merged.append(list(idxs))
    return merged


def is_protected_gatsby(m: Movie) -> bool:
    return "gatsby" in m.normalized_title


def is_protected_dragon_tattoo(m: Movie) -> bool:
    return "dragon tattoo" in m.normalized_title


def is_protected_fly(m: Movie) -> bool:
    return m.normalized_title == "fly"


def _contains(m: Movie, *needles: str) -> bool:
    n = m.normalized_title
    return any(nd in n for nd in needles)


def franchise_predicates() -> tuple[Callable[[Movie], bool], ...]:
    """Same-story groups Wikipedia splits across rows or marks only in italics."""

    def affair_indian(m: Movie) -> bool:
        n = m.normalized_title
        if n == "mann":
            return True
        return _contains(
            m,
            "pyar jhukta",
            "nee bareda kadambari",
            "babai abbai",
        )

    def unfaithful_murder(m: Movie) -> bool:
        if "unfaithful" in m.normalized_title:
            return True
        return m.normalized_title == "murder" and m.year == 2004

    def body_corpo(m: Movie) -> bool:
        n = m.normalized_title
        if "il corpo" in n or "el cuerpo" in n:
            return True
        return n == "body" and m.year in (2012, 2019)

    def pokemon_line(m: Movie) -> bool:
        return "pokemon" in m.normalized_title

    def pink_vakeel(m: Movie) -> bool:
        n = m.normalized_title
        if "vakeel" in n or "nerkonda" in n:
            return True
        return n == "pink" and m.year == 2016

    def naadodigal_chain(m: Movie) -> bool:
        return m.normalized_title in (
            "naadodigal",
            "rangrezz",
            "hudugaru",
            "ithu nammude katha",
            "shambo shiva shambo",
        )

    def hustle_chain(m: Movie) -> bool:
        n = m.normalized_title
        return (
            "dirty rotten" in n
            or n == "hustle"
            or "bedtime story" in n
        )

    def my_favorite_wife_chain(m: Movie) -> bool:
        n = m.normalized_title
        if "my favorite wife" in n or "move over darling" in n:
            return True
        # 1962 unfinished Monroe/Cukor remake; not Something's Gotta Give (2003)
        return "something s got to give" in n

    def judge_dredd_line(m: Movie) -> bool:
        n = m.normalized_title
        return "judge dredd" in n or n == "dredd"

    def mr_deeds_hello_billionaire(m: Movie) -> bool:
        n = m.normalized_title
        return "hello mr billionaire" in n or n == "mr deeds"

    def prancer_films(m: Movie) -> bool:
        return "prancer" in m.normalized_title

    def baasha_arunachalam(m: Movie) -> bool:
        return m.normalized_title in ("baasha", "arunachalam")

    def brewster_millions_chain(m: Movie) -> bool:
        n = m.normalized_title
        return (
            ("brewster" in n and "million" in n)
            or "three on a spree" in n
            or n == "maalamaal"
            or "million to juan" in n
        )

    def dial_m_perfect_murder(m: Movie) -> bool:
        n = m.normalized_title
        return "dial m for murder" in n or n == "perfect murder"

    def four_steps_walk_clouds(m: Movie) -> bool:
        return _contains(m, "four steps in the clouds", "walk in the clouds")

    def storm_in_summer_tv(m: Movie) -> bool:
        return m.normalized_title == "storm in summer"

    def midnight_lace_chain(m: Movie) -> bool:
        return "midnight lace" in m.normalized_title

    def collinwood_big_deal(m: Movie) -> bool:
        n = m.normalized_title
        return "welcome to collinwood" in n or "big deal on madonna street" in n

    def boudu_saved_chain(m: Movie) -> bool:
        n = m.normalized_title
        return n == "boudu" or "boudu saved from drowning" in n

    def tere_naam_sethu(m: Movie) -> bool:
        return m.normalized_title in ("tere naam", "sethu")

    def vikramarkudu_rowdy_rathore(m: Movie) -> bool:
        n = m.normalized_title
        return "vikramarkudu" in n or "rowdy rathore" in n

    def gulumaal_all_best_telugu(m: Movie) -> bool:
        n = m.normalized_title
        if "gulumaal" in n:
            return True
        return n == "all the best" and m.year == 2012

    def chinthamani_mahalakshmi(m: Movie) -> bool:
        return m.normalized_title in (
            "chinthamani kolacase",
            "ellam avan seyal",
            "sri mahalakshmi",
        )

    def naukar_vahuti_biwi(m: Movie) -> bool:
        n = m.normalized_title
        return "naukar vahuti da" in n or "naukar biwi ka" in n

    def omg_gopala_mukunda(m: Movie) -> bool:
        return m.normalized_title in ("omg oh my god", "gopala gopala", "mukunda murari")

    def death_holiday_meet_joe_black(m: Movie) -> bool:
        return m.normalized_title in ("death takes a holiday", "meet joe black")

    return (
        lambda m: _contains(m, "poseidon adventure", "poseidon"),
        lambda m: "piranha" in m.normalized_title,
        lambda m: _contains(m, "what men want", "what women want"),
        lambda m: _contains(m, "miss granny", "sweet 20", "20 once again"),
        lambda m: _contains(
            m,
            "secret in their eyes",
            "the secret in their eyes",
            "el secreto de sus ojos",
        ),
        lambda m: m.normalized_title.startswith("day of the dead"),
        lambda m: _contains(m, "yojimbo", "fistful of dollars", "last man standing"),
        lambda m: _contains(m, "get carter", "payback"),
        lambda m: _contains(m, "la femme nikita", "point of no return"),
        lambda m: _contains(m, "heaven can wait"),
        affair_indian,
        hustle_chain,
        unfaithful_murder,
        pokemon_line,
        body_corpo,
        pink_vakeel,
        naadodigal_chain,
        brewster_millions_chain,
        dial_m_perfect_murder,
        four_steps_walk_clouds,
        storm_in_summer_tv,
        midnight_lace_chain,
        collinwood_big_deal,
        boudu_saved_chain,
        tere_naam_sethu,
        vikramarkudu_rowdy_rathore,
        gulumaal_all_best_telugu,
        chinthamani_mahalakshmi,
        naukar_vahuti_biwi,
        omg_gopala_mukunda,
        death_holiday_meet_joe_black,
        my_favorite_wife_chain,
        judge_dredd_line,
        mr_deeds_hello_billionaire,
        prancer_films,
        baasha_arunachalam,
    )


def infer_families(movies: list[Movie]) -> dict[str, list[Movie]]:
    n = len(movies)
    uf = UnionFind(n)

    for wiki_name in ("film_remakes_A_M.md", "film_remakes_N_Z.md"):
        path = WIKI_DIR / wiki_name
        if not path.exists():
            continue
        for original, remakes in iter_wiki_table_rows(path):
            row_indices: list[int] = []
            for cell in (original, remakes):
                for title, link, year in films_from_wiki_cell(cell):
                    row_indices.extend(match_movie_indices(movies, title, link, year))
            union_clique(uf, row_indices)

    for pred in franchise_predicates():
        union_clique(uf, [i for i, m in enumerate(movies) if pred(m)])

    for pred in (is_protected_gatsby, is_protected_dragon_tattoo, is_protected_fly):
        union_clique(uf, [i for i, m in enumerate(movies) if pred(m)])

    for group in infer_signature_group_indices(movies):
        union_clique(uf, group)

    components: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        components[uf.find(i)].append(i)

    sorted_roots = sorted(
        components.keys(),
        key=lambda r: (
            min((movies[i].year for i in components[r] if movies[i].year), default=9999),
            min(movies[i].normalized_title for i in components[r]),
        ),
    )

    families: dict[str, list[Movie]] = {}
    for idx, root in enumerate(sorted_roots, start=1):
        family_id = f"FAM{idx:04d}"
        member_idxs = sorted(
            components[root],
            key=lambda i: (movies[i].year if movies[i].year is not None else 9999, movies[i].title),
        )
        fam_movies = [movies[i] for i in member_idxs]
        for m in fam_movies:
            m.family_id = family_id
        families[family_id] = fam_movies

    _warn_protected_franchises(movies, uf)
    return families


def _warn_protected_franchises(movies: list[Movie], uf: UnionFind) -> None:
    checks = [
        ("The Great Gatsby", is_protected_gatsby),
        ("The Girl with the Dragon Tattoo", is_protected_dragon_tattoo),
        ("The Fly", is_protected_fly),
    ]
    for label, pred in checks:
        idxs = [i for i, m in enumerate(movies) if pred(m)]
        if not idxs:
            print(f"Note: no CSV rows matched protected franchise {label!r}.")
            continue
        roots = {uf.find(i) for i in idxs}
        if len(roots) > 1:
            print(f"Warning: protected franchise {label!r} split across {len(roots)} families.")


def needs_review(group: Iterable[Movie]) -> bool:
    group = list(group)
    if len(group) == 1:
        return False
    titles = [movie.normalized_title for movie in group]
    min_similarity = 1.0
    for i, title_a in enumerate(titles):
        for title_b in titles[i + 1 :]:
            min_similarity = min(min_similarity, similarity(title_a, title_b))
    return min_similarity < 0.88


def write_outputs(movies: list[Movie], families: dict[str, list[Movie]]) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    movies_out = PROCESSED_DIR / "movies_with_families.csv"
    with movies_out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "movie",
                "year",
                "tmdb_link",
                "tmdb_id",
                "genres",
                "normalized_title",
                "family_id",
            ],
        )
        writer.writeheader()
        for movie in sorted(
            movies,
            key=lambda m: (m.family_id, m.year if m.year is not None else 9999, m.title),
        ):
            writer.writerow(
                {
                    "movie": movie.title,
                    "year": movie.year if movie.year is not None else "",
                    "tmdb_link": movie.tmdb_link,
                    "tmdb_id": movie.tmdb_id if movie.tmdb_id is not None else "",
                    "genres": ", ".join(movie.genres),
                    "normalized_title": movie.normalized_title,
                    "family_id": movie.family_id,
                }
            )

    json_out = PROCESSED_DIR / "movies_with_families.json"
    with json_out.open("w", encoding="utf-8") as handle:
        json.dump(
            [
                {
                    "title": movie.title,
                    "year": movie.year,
                    "tmdb_link": movie.tmdb_link,
                    "tmdb_id": movie.tmdb_id,
                    "genres": movie.genres,
                    "normalized_title": movie.normalized_title,
                    "family_id": movie.family_id,
                }
                for movie in sorted(
                    movies,
                    key=lambda m: (m.family_id, m.year if m.year is not None else 9999, m.title),
                )
            ],
            handle,
            indent=2,
        )

    review_out = REVIEW_DIR / "family_inference_review.csv"
    with review_out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["family_id", "movie_count", "titles", "years", "needs_review"],
        )
        writer.writeheader()
        for family_id, group in families.items():
            writer.writerow(
                {
                    "family_id": family_id,
                    "movie_count": len(group),
                    "titles": " | ".join(sorted({movie.title for movie in group})),
                    "years": ", ".join(
                        str(year) for year in sorted({movie.year for movie in group if movie.year})
                    ),
                    "needs_review": "yes" if needs_review(group) else "no",
                }
            )


def main() -> None:
    movies = load_movies()
    families = infer_families(movies)
    write_outputs(movies, families)
    singletons = sum(1 for g in families.values() if len(g) == 1)
    multi = len(families) - singletons
    print(f"Loaded movies: {len(movies)}")
    print(f"Inferred families: {len(families)} ({multi} with 2+ films, {singletons} singletons)")
    wiki_used = sum(1 for n in ("film_remakes_A_M.md", "film_remakes_N_Z.md") if (WIKI_DIR / n).exists())
    print(f"Wikipedia remake tables found: {wiki_used}/2 under {WIKI_DIR.relative_to(ROOT)}")
    print("Wrote data/analisis/movies_with_families.* and data/analisis/review/family_inference_review.csv")


if __name__ == "__main__":
    main()

