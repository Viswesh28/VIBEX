import { SearchPlaylistModel } from "../../models/index.js";
import { SearchPlaylistsUseCase } from "../index.js";
import { beforeAll, describe, expect, it } from "vitest";
describe("SearchPlaylists", () => {
  let searchPlaylistsUseCase;
  beforeAll(() => {
    searchPlaylistsUseCase = new SearchPlaylistsUseCase();
  });
  it("should search playlists by query and return a list of playlists", async () => {
    const playlists = await searchPlaylistsUseCase.execute({ query: "indie", limit: 5, page: 0 });
    expect(() => SearchPlaylistModel.parse(playlists)).not.toThrow();
  });
});
