import { SongAPIResponseModel, SongModel } from "../../songs/models/index.js";
import { z } from "zod";
const SearchSongAPIResponseModel = z.object({
  total: z.number(),
  start: z.number(),
  results: z.array(SongAPIResponseModel)
});
const SearchSongModel = z.object({
  total: z.number(),
  start: z.number(),
  results: z.array(SongModel)
});
export {
  SearchSongAPIResponseModel,
  SearchSongModel
};
