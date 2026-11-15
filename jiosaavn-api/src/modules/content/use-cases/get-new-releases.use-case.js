import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createSongPayload } from '../../songs/helpers/index.js'
import { interleaveFeedSongs, parseLanguages, sortFeedSongs } from '../helpers/index.js'
import { GetTrendingSongsUseCase } from './get-trending-songs.use-case.js'

export class GetNewReleasesUseCase {
  trendingFallback

  constructor() {
    this.trendingFallback = new GetTrendingSongsUseCase()
  }

  async execute({ languages, limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => sortFeedSongs(r.value, 'newest'))

    const merged = interleaveFeedSongs(lists, limit)
    if (merged.length >= Math.min(limit, 6)) return merged

    // Supplement with newest-sorted live trending songs if browse modules have mostly albums.
    const extra = await this.trendingFallback.execute({ languages: langs, sort: 'newest', limit })
    return interleaveFeedSongs([merged, extra], limit)
  }

  async fetchLanguage(language) {
    const { data, ok } = await useFetch({
      endpoint: Endpoints.modules,
      params: {},
      cookie: `L=${language}`
    })
    if (!ok || !data) return []
    const candidates = [
      ...(Array.isArray(data.new_albums) ? data.new_albums : []),
      ...(Array.isArray(data.new_trending) ? data.new_trending : [])
    ]
    return candidates
      .filter((entry) => entry?.type === 'song' && entry?.id && entry?.more_info?.encrypted_media_url)
      .map(createSongPayload)
  }
}
