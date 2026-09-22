import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createSongPayload } from '../../../songs/helpers/index.js';
export class SearchSongsUseCase {
    constructor() { }
    async execute({ query, limit, page }) {
        const { data } = await useFetch({
            endpoint: Endpoints.search.songs,
            params: {
                q: query,
                p: page,
                n: limit
            }
        });
        return {
            total: data.total,
            start: data.start,
            results: data.results?.map(createSongPayload).slice(0, limit) || []
        };
    }
}
