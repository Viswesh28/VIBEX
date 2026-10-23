import { Endpoints } from '../../../../common/constants/index.js'
import { ApiContextEnum } from '../../../../common/enums/index.js'
import { useFetch } from '../../../../common/helpers/index.js'
import { createSongPayload } from '../../../songs/helpers/index.js'
import { CreateSongStationUseCase } from '../../../songs/use-cases/index.js'
import { HTTPException } from 'hono/http-exception'

export class GetSongSuggestionsUseCase {
  createSongStation
  constructor() {
    this.createSongStation = new CreateSongStationUseCase()
  }
  async execute({ songId, limit }) {
    const stationId = await this.createSongStation.execute(songId)
    const { data, ok } = await useFetch({
      endpoint: Endpoints.songs.suggestions,
      params: {
        stationid: stationId,
        k: limit
      },
      context: ApiContextEnum.ANDROID
    })
    if (!data || !ok) {
      throw new HTTPException(404, { message: 'no suggestions found for the given song' })
    }
    const { stationid, ...suggestions } = data
    return (
      Object.values(suggestions)
        .filter((element) => element && typeof element === 'object' && element.song?.id)
        .map((element) => createSongPayload(element.song))
        .slice(0, limit) || []
    )
  }
}
