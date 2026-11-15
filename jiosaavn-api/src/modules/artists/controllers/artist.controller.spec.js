import { ArtistModel } from "../models/index.js";
import { ArtistController } from "../../index.js";
import { beforeAll, describe, expect, it } from "vitest";
describe("ArtistController", () => {
  let artistController;
  beforeAll(() => {
    artistController = new ArtistController();
    artistController.initRoutes();
  });
  it("retrieve artist by link", async () => {
    const response = await artistController.controller.request(
      "/artists?link=https://www.jiosaavn.com/artist/dua-lipa-songs/r-OWIKgpX2I_"
    );
    const { data } = await response.json();
    expect(() => ArtistModel.parse(data)).not.toThrow();
  });
});
