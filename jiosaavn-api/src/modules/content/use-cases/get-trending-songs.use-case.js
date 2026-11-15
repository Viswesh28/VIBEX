import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'
import { interleaveFeedSongs, parseLanguages, sortFeedSongs } from '../helpers/index.js'

export class GetTrendingSongsUseCase {
  async execute({ languages, sort = 'trending', limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => sortFeedSongs(r.value, sort))
    return interleaveFeedSongs(lists, limit)
  }

  async fetchLanguage(language) {
    const { data, ok } = await useFetch({
      endpoint: Endpoints.trending,
      params: { entity_type: 'song', entity_language: language },
      cookie: `L=${language}`
    })
    const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []
    if (!ok || !items.length) return []
    return items
      .filter((song) => song?.id && song?.more_info?.encrypted_media_url)
      .map(createSongPayload)
  }
}
