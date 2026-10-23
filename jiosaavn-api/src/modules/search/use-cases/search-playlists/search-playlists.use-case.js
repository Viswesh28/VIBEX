import { Endpoints } from "../../../../common/constants/index.js";
import { useFetch } from "../../../../common/helpers/index.js";
import { createSearchPlaylistPayload } from "../../helpers/index.js";
import { HTTPException } from "hono/http-exception";
class SearchPlaylistsUseCase {
  constructor() {
  }
  async execute({ query, limit, page }) {
    const { data } = await useFetch({
      endpoint: Endpoints.search.playlists,
      params: {
        q: query,
        p: page,
        n: limit
      }
    });
    if (!data) throw new HTTPException(404, { message: "playlist not found" });
    return createSearchPlaylistPayload(data);
  }
}
export {
  SearchPlaylistsUseCase
};
