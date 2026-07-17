import { Router } from "express";
import { requireAuth, requireApproved } from "../middlewares/auth";

const router = Router();

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_TOKEN = process.env.TMDB_API_KEY ?? "";

async function tmdb(path: string, params: Record<string, string> = {}) {
  if (!TMDB_TOKEN) {
    throw new Error("TMDB_API_KEY is not configured");
  }
  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  // Supports both v3 API keys and v4 Bearer tokens (JWT starting with eyJ)
  const headers: Record<string, string> = { accept: "application/json" };
  if (TMDB_TOKEN.startsWith("eyJ")) {
    headers["Authorization"] = `Bearer ${TMDB_TOKEN}`;
  } else {
    url.searchParams.set("api_key", TMDB_TOKEN);
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function mapItem(item: Record<string, unknown>, mediaType?: string) {
  const type = mediaType || (item.media_type as string) || "movie";
  const title =
    (item.title as string) || (item.name as string) || "Unknown";
  const releaseDate =
    (item.release_date as string) ||
    (item.first_air_date as string) ||
    null;

  const genres = (
    (item.genre_ids as number[]) ||
    (item.genres as { name: string }[])?.map((g) => g.name) ||
    []
  );

  return {
    id: item.id as number,
    tmdbId: item.id as number,
    type: type === "tv" ? "tv" : "movie",
    title,
    posterPath: item.poster_path as string | null,
    backdropPath: item.backdrop_path as string | null,
    overview: (item.overview as string) || "",
    releaseDate,
    rating: (item.vote_average as number) || 0,
    voteCount: (item.vote_count as number) || 0,
    genres: Array.isArray(genres)
      ? genres.map((g: unknown) =>
          typeof g === "string" ? g : (g as { name: string }).name,
        )
      : [],
  };
}

// GET /api/content/trending
router.get("/trending", requireAuth, requireApproved, async (req, res) => {
  try {
    const type = (req.query.type as string) || "all";
    const mediaType = type === "all" ? "all" : type;
    const data = await tmdb(`/trending/${mediaType}/week`);
    const results = (data.results as Record<string, unknown>[]).map((item) =>
      mapItem(item, type === "all" ? undefined : type),
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/content/popular
router.get("/popular", requireAuth, requireApproved, async (req, res) => {
  try {
    const type = (req.query.type as string) || "movie";
    const data = await tmdb(`/${type}/popular`);
    const results = (data.results as Record<string, unknown>[]).map((item) =>
      mapItem(item, type),
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/content/search
router.get("/search", requireAuth, requireApproved, async (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    const type = (req.query.type as string) || "all";
    const page = (req.query.page as string) || "1";

    if (!q) {
      res.json({ results: [], totalResults: 0, page: 1, totalPages: 0 });
      return;
    }

    const endpoint =
      type === "movie"
        ? "/search/movie"
        : type === "tv"
          ? "/search/tv"
          : "/search/multi";

    const data = await tmdb(endpoint, { query: q, page });
    const results = (data.results as Record<string, unknown>[])
      .filter(
        (item) =>
          type === "all" ||
          item.media_type === type ||
          !item.media_type,
      )
      .map((item) => mapItem(item, type === "all" ? undefined : type));

    res.json({
      results,
      totalResults: (data.total_results as number) || 0,
      page: (data.page as number) || 1,
      totalPages: (data.total_pages as number) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/content/movie/:id
router.get("/movie/:id", requireAuth, requireApproved, async (req, res) => {
  try {
    const data = await tmdb(`/movie/${req.params.id}`, {
      append_to_response: "credits,videos",
    });

    const genres = (data.genres as { name: string }[]) || [];
    const cast = (
      (data.credits as { cast: Record<string, unknown>[] })?.cast || []
    )
      .slice(0, 15)
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        character: (c.character as string) || "",
        profilePath: (c.profile_path as string | null) ?? null,
      }));

    const videos =
      (data.videos as { results: Record<string, unknown>[] })?.results || [];
    const trailer = videos.find(
      (v) => v.type === "Trailer" && v.site === "YouTube",
    );

    res.json({
      id: data.id as number,
      tmdbId: data.id as number,
      type: "movie",
      title: (data.title as string) || "",
      posterPath: (data.poster_path as string | null) ?? null,
      backdropPath: (data.backdrop_path as string | null) ?? null,
      overview: (data.overview as string) || "",
      releaseDate: (data.release_date as string | null) ?? null,
      rating: (data.vote_average as number) || 0,
      voteCount: (data.vote_count as number) || 0,
      genres: genres.map((g) => g.name),
      runtime: (data.runtime as number | null) ?? null,
      status: (data.status as string | null) ?? null,
      tagline: (data.tagline as string | null) ?? null,
      seasons: [],
      cast,
      trailerKey: trailer ? (trailer.key as string) : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/content/tv/:id
router.get("/tv/:id", requireAuth, requireApproved, async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}`, {
      append_to_response: "credits,videos",
    });

    const genres = (data.genres as { name: string }[]) || [];
    const cast = (
      (data.credits as { cast: Record<string, unknown>[] })?.cast || []
    )
      .slice(0, 15)
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        character: (c.character as string) || "",
        profilePath: (c.profile_path as string | null) ?? null,
      }));

    const seasons = (
      (data.seasons as Record<string, unknown>[]) || []
    ).map((s) => ({
      seasonNumber: s.season_number as number,
      name: (s.name as string) || `Season ${s.season_number}`,
      episodeCount: (s.episode_count as number) || 0,
      posterPath: (s.poster_path as string | null) ?? null,
    }));

    const videos =
      (data.videos as { results: Record<string, unknown>[] })?.results || [];
    const trailer = videos.find(
      (v) => v.type === "Trailer" && v.site === "YouTube",
    );

    res.json({
      id: data.id as number,
      tmdbId: data.id as number,
      type: "tv",
      title: (data.name as string) || "",
      posterPath: (data.poster_path as string | null) ?? null,
      backdropPath: (data.backdrop_path as string | null) ?? null,
      overview: (data.overview as string) || "",
      releaseDate: (data.first_air_date as string | null) ?? null,
      rating: (data.vote_average as number) || 0,
      voteCount: (data.vote_count as number) || 0,
      genres: genres.map((g) => g.name),
      runtime: null,
      status: (data.status as string | null) ?? null,
      tagline: (data.tagline as string | null) ?? null,
      seasons,
      cast,
      trailerKey: trailer ? (trailer.key as string) : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/content/embed — returns the embed iframe URL
router.get("/embed", requireAuth, requireApproved, (req, res) => {
  const { type, id, season, episode } = req.query as Record<string, string>;

  if (!type || !id) {
    res.status(400).json({ error: "type and id are required" });
    return;
  }

  let embedUrl: string;
  if (type === "movie") {
    embedUrl = `https://vidsrc.to/embed/movie/${id}`;
  } else if (type === "tv" && season && episode) {
    embedUrl = `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`;
  } else if (type === "tv") {
    embedUrl = `https://vidsrc.to/embed/tv/${id}`;
  } else {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  res.json({ embedUrl, provider: "vidsrc.to" });
});

export default router;
