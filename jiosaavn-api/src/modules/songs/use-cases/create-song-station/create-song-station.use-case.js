import { Endpoints } from '../../../../common/constants/index.js';
import { ApiContextEnum } from '../../../../common/enums/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class CreateSongStationUseCase {
    constructor() { }
    async execute(songId) {
        const encodedSongId = JSON.stringify([encodeURIComponent(songId)]);
        const { data, ok } = await useFetch({
            endpoint: Endpoints.songs.station,
            params: {
                entity_id: encodedSongId,
                entity_type: 'queue'
            },
            context: ApiContextEnum.ANDROID
        });
        if (!data || !ok || !data.stationid)
            throw new HTTPException(500, { message: 'could not create station' });
        return data.stationid;
    }
}
