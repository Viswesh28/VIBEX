import { z } from "zod";
import { SongAPIResponseModel } from "./song.model.js";
const SongStationAPIResponseModel = z.record(
  z.string(),
  z.object({
    song: SongAPIResponseModel
  })
);
const SongSuggestionAPIResponseModel = z.object({
  stationid: z.string()
}).and(SongStationAPIResponseModel);
export {
  SongSuggestionAPIResponseModel
};
