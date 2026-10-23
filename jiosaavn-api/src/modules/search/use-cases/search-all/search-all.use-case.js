import { Endpoints } from "../../../../common/constants/index.js";
import { useFetch } from "../../../../common/helpers/index.js";
import { createSearchPayload } from "../../helpers/index.js";
import { HTTPException } from "hono/http-exception";
class SearchAllUseCase {
  async execute(query) {
    const { data } = await useFetch({
      endpoint: Endpoints.search.all,
      params: { query }
    });
    if (!data) throw new HTTPException(404, { message: `no results found for ${query}` });
    return createSearchPayload(data);
  }
}
export {
  SearchAllUseCase
};
