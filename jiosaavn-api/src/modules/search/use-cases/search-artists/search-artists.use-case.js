import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createArtistMapPayload } from '../../../artists/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class SearchArtistsUseCase {
    constructor() { }
    async execute({ query, limit, page }) {
        const { data } = await useFetch({
            endpoint: Endpoints.search.artists,
            params: {
                q: query,
                p: page,
                n: limit
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'artist not found' });
        return {
            total: data.total,
            start: data.start,
            results: data.results?.map(createArtistMapPayload).slice(0, limit) || []
        };
    }
}
