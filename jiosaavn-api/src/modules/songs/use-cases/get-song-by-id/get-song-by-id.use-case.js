import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createSongPayload } from '../../../songs/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetSongByIdUseCase {
    constructor() { }
    async execute({ songIds }) {
        const { data } = await useFetch({
            endpoint: Endpoints.songs.id,
            params: {
                pids: songIds
            }
        });
        if (!data.songs?.length)
            throw new HTTPException(404, { message: 'song not found' });
        const songs = data.songs.map((song) => createSongPayload(song));
        return songs;
    }
}
