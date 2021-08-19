let ObjectID = require('mongodb').ObjectID
let MongoClient = require('mongodb').MongoClient
let _ = require('lodash/fp')

MongoClient.max_delay = 0

let url = 'mongodb://app:development@localhost:27017/contexture-test'
//let url = 'mongodb://root:development@localhost:27017/admin'

module.exports = async ({ collection: collectionName }) => {
  let client = await MongoClient.connect(url, {})
  const db = client.db("contexture-test")
  let collection = db.collection(collectionName)
  let ids = [new ObjectID(), new ObjectID(), new ObjectID()]

  let count = 0
  let docs = _.map(
    _id => ({
      _id,
      code: `${++count}${count}${count + 1}${count + 1}${count + 2}${count +
        2}`,
      nextCode: ids[count] || ids[0],
    }),
    ids
  )

  await collection.deleteMany({})
  await collection.insertMany(docs)

//  afterAll(async () => {
//    console.info('AFTERALL')
//    await collection.remove({})
//    client.close()
//  })

  return {
    client,
    db,
    ids,
  }
}
