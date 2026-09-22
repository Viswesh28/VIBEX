import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createArtistPayload } from '../../../artists/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetArtistByIdUseCase {
    constructor() { }
    async execute({ artistId, page, songCount, albumCount, sortBy, sortOrder }) {
        const { data } = await useFetch({
            endpoint: Endpoints.artists.id,
            params: {
                artistId,
                n_song: songCount,
                n_album: albumCount,
                page,
                sort_order: sortOrder,
                category: sortBy
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'artist not found' });
        return createArtistPayload(data);
    }
}
