import { DownloadLinkModel } from "../../../common/models/index.js";
import { z } from "zod";
const ArtistMapAPIResponseModel = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  type: z.string(),
  image: z.string(),
  perma_url: z.string()
});
const ArtistMapModel = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  type: z.string(),
  image: z.array(DownloadLinkModel),
  url: z.string()
});
export {
  ArtistMapAPIResponseModel,
  ArtistMapModel
};
