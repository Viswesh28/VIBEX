import { z } from "zod";
const DownloadLinkModel = z.object({
  quality: z.string(),
  url: z.string()
});
export {
  DownloadLinkModel
};
