import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createAlbumPayload } from '../../../albums/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetArtistAlbumsUseCase {
    constructor() { }
    async execute({ artistId, page, sortOrder, sortBy }) {
        const { data } = await useFetch({
            endpoint: Endpoints.artists.albums,
            params: {
                artistId,
                page,
                sort_order: sortOrder,
                category: sortBy
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'artist albums not found' });
        return {
            total: data.topAlbums.total,
            albums: data.topAlbums.albums.map((album) => createAlbumPayload(album))
        };
    }
}
