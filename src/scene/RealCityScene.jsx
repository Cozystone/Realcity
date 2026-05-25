import Atmosphere from './Atmosphere'
import CityMeshes from './CityMeshes'
import Actors from './Actors'
import PlayerRig from './PlayerRig'
import PostFX from './PostFX'

export default function RealCityScene({ city }) {
  return (
    <>
      <Atmosphere />
      <CityMeshes city={city} />
      <Actors city={city} />
      <PlayerRig city={city} />
      <PostFX />
    </>
  )
}
