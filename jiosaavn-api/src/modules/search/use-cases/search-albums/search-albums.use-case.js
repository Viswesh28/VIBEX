import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createSearchAlbumPayload } from '../../../search/helpers/index.js';
export class SearchAlbumsUseCase {
    constructor() { }
    async execute({ query, limit, page }) {
        const { data } = await useFetch({
            endpoint: Endpoints.search.albums,
            params: {
                q: query,
                p: page,
                n: limit
            }
        });
        return createSearchAlbumPayload(data);
    }
}
