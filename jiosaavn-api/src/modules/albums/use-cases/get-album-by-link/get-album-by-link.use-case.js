import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createAlbumPayload } from '../../../albums/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetAlbumByLinkUseCase {
    constructor() { }
    async execute(token) {
        const { data } = await useFetch({
            endpoint: Endpoints.albums.link,
            params: {
                token,
                type: 'album'
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'album not found' });
        return createAlbumPayload(data);
    }
}
