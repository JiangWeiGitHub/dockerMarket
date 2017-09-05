import Promise from 'bluebird'

const appifiInit = require('./appifi/index').appifiInit
// const appifiStart = require('./appifi/index').appstoreStart

const main = async () => {

  await appifiInit('/home/john/git/dockerMarket/mountpoint')
  // await appifiStart()

}

main().asCallback(err => err && console.log(err))

