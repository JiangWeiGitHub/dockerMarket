// import { developerState } from './storeState'

const imagePrefix = (imagePath) => {

  let url = 'https://raw.githubusercontent.com/JiangWeiGitHub/dockerMarket/master' + imagePath
  // if (developerState() && developerState().appstoreMaster) {
  //   url = 'https://raw.githubusercontent.com/wisnuc/appifi-recipes/master' + imagePath
  // }
  // else 
  //   url = 'https://raw.githubusercontent.com/wisnuc/appifi-recipes/release' + imagePath
  return url
}

export default imagePrefix

