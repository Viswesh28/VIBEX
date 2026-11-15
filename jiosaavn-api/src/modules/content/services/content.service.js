import {
  GetNewAlbumsUseCase,
  GetNewReleasesUseCase,
  GetTrendingSongsUseCase
} from '../use-cases/index.js'

export class ContentService {
  trendingSongs = new GetTrendingSongsUseCase()
  newReleases = new GetNewReleasesUseCase()
  newAlbums = new GetNewAlbumsUseCase()

  getTrendingSongs(args) {
    return this.trendingSongs.execute(args)
  }

  getNewReleases(args) {
    return this.newReleases.execute(args)
  }

  getNewAlbums(args) {
    return this.newAlbums.execute(args)
  }
}
