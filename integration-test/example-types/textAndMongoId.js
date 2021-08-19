let types = require('../../types')()
let Contexture = require('contexture')
let provider = require('../../src')
let _ = require('lodash/fp')
let testSetup = require('../setup')

let schemaName = 'Documents'
let collection = 'document'
let clients = []

const asyncPipe = (...fns) => x => fns.reduce(async (y, f) => f(await y), x)

afterAll(async () => {
  await asyncPipe(...clients)(()=>{})
})

let contextureTestSetup = async ({ collection }) => {
  let { client, db, ids } = await testSetup({ collection })
  clients.push(() => client.close())

  return {
    db,
    ids,
    process: Contexture({
      schemas: {
        [schemaName]: {
          mongo: {
            collection,
          },
        },
      },
      providers: {
        mongo: provider({
          getClient: () => db,
          types,
        }),
      },
    }),
  }
}

describe('Grouping text and mongoId', () => {
  it('should work', async () => {
    try {
      let {
        ids: [id],
        process,
      } = await contextureTestSetup({ collection })

      let dsl = {
        type: 'group',
        schema: schemaName,
        join: 'and',
        items: [
          {
            key: 'text',
            type: 'text',
            field: 'code',
            data: {
              operator: 'containsWord',
              value: '22',
            },
          },
          {
            key: 'specificUser',
            type: 'mongoId',
            field: '_id',
            data: {
              value: id,
            },
          },
          {
            key: 'results',
            type: 'results',
          },
        ],
      }

      let result = await process(dsl, { debug: true })
      let response = _.last(result.items).context.response

      expect(response.totalRecords).toBe(3)
      expect(response.results[0]._id.toString()).toBe(id.toString())
    } catch (err) {
      expect(err).toBe(false)
    }
  })

  it('should work with populate', async () => {
    let {
      ids: [id, id2],
      process,
    } = await contextureTestSetup({ collection })

    let dsl = {
      type: 'group',
      schema: schemaName,
      join: 'and',
      items: [
        {
          key: 'text',
          type: 'text',
          field: 'code',
          data: {
            operator: 'containsWord',
            value: '22',
          },
        },
        {
          key: 'specificUser',
          type: 'mongoId',
          field: '_id',
          data: {
            value: id,
          },
        },
        {
          key: 'results',
          type: 'results',
          config: {
            populate: {
              child: {
                schema: 'Documents',
                foreignField: '_id',
                localField: 'nextCode',
              },
            },
          },
        },
      ],
    }

    let result = await process(dsl, { debug: true })
    let response = _.last(result.items).context.response

    expect(response.totalRecords).toBe(3)
    expect(response.results[0]._id.toString()).toBe(id.toString())
    expect(response.results[0].nextCode.toString()).toBe(id2.toString())
  })
})
