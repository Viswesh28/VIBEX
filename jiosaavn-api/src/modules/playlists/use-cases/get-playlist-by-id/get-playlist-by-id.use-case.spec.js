import { PlaylistModel } from "../../models/index.js";
import { GetPlaylistByIdUseCase } from "../index.js";
import { beforeAll, describe, expect, it } from "vitest";
describe("GetAlbumById", () => {
  let getPlaylistByIdUseCase;
  beforeAll(() => {
    getPlaylistByIdUseCase = new GetPlaylistByIdUseCase();
  });
  it("should get playlist by id", async () => {
    const playlist = await getPlaylistByIdUseCase.execute({
      id: "159470188",
      page: 1,
      limit: 5
    });
    expect(() => PlaylistModel.parse(playlist)).not.toThrow();
  });
});
