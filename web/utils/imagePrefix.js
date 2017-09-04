import { developerState } from './storeState'

const imagePrefix = (imagePath) => {

  let url
  if (developerState() && developerState().appstoreMaster) {
    url = 'https://raw.githubusercontent.com/dockerMarket/appifi-recipes/master' + imagePath
  }
  else 
    url = 'https://raw.githubusercontent.com/dockerMarket/appifi-recipes/release' + imagePath
  return url
}

export default imagePrefix

