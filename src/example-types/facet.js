let F = require('futil')
let _ = require('lodash/fp')
let { ObjectID } = require('mongodb')

let projectStageFromLabelFields = node => ({
  $project: {
    count: 1,
    ...F.arrayToObject(
      fieldName => `label.${fieldName}`,
      _.constant(1)
    )(_.flow(_.get('label.fields'), _.castArray)(node)),
  },
})

let sortAndLimitIfSearching = (shouldSortAndLimit, limit) =>
  shouldSortAndLimit
    ? [{ $sort: { count: -1 } }, limit !== 0 && { $limit: limit || 10 }]
    : []

let sortAndLimitIfNotSearching = (should, limit) =>
  sortAndLimitIfSearching(!should, limit)

let getSearchableKeysList = _.flow(
  _.getOr('_id', 'label.fields'),
  _.castArray,
  _.map(label => (label === '_id' ? label : `label.${label}`))
)

let getMatchesForMultipleKeywords = (list, optionsFilter) => ({
  $and: _.map(
    option => ({
      $or: _.map(
        key => ({
          [key]: {
            $regex: F.wordsToRegexp(option),
            $options: 'i',
          },
        }),
        list
      ),
    }),
    _.words(optionsFilter)
  ),
})

let setMatchOperators = (list, node) =>
  list.length > 1
    ? getMatchesForMultipleKeywords(list, node.optionsFilter)
    : {
        [_.first(list)]: {
          $regex: F.wordsToRegexp(node.optionsFilter),
          $options: 'i',
        },
      }

let mapKeywordFilters = node =>
  node.optionsFilter &&
  _.flow(getSearchableKeysList, list => ({
    $match: setMatchOperators(list, node),
  }))(node)

let lookupLabel = node =>
  _.get('label', node)
    ? [
        {
          $lookup: {
            from: _.get('label.collection', node),
            as: 'label',
            localField: '_id',
            foreignField: _.get('label.foreignField', node),
          },
        },
        {
          $unwind: {
            path: '$label',
            preserveNullAndEmptyArrays: true,
          },
        },
      ]
    : []

let facetValueLabel = (node, label) => {
  if (!node.label) {
    return {}
  }
  if (!node.label.fields || _.isArray(node.label.fields)) {
    return { label }
  }
  return {
    label: _.flow(_.values, _.first)(label),
  }
}

let unwindPropOrField = node =>
  _.map(
    field => ({ $unwind: `$${field}` }),
    _.castArray(node.unwind || node.field)
  )

module.exports = {
  hasValue: _.get('values.length'),
  filter: node => ({
    [node.field]: {
      [node.mode === 'exclude' ? '$nin' : '$in']: node.isMongoId
        ? _.map(ObjectID, node.values)
        : node.values,
    },
  }),
  async result(node, search, schema, config) {
    let values = _.get('values', node)
    let results = await Promise.all([
      search(
        _.compact([
          // Unwind allows supporting array and non array fields - for non arrays, it will treat as an array with 1 value
          // https://docs.mongodb.com/manual/reference/operator/aggregation/unwind/#non-array-field-path
          ...unwindPropOrField(node),
          { $group: { _id: `$${node.field}`, count: { $sum: 1 } } },
          ...sortAndLimitIfNotSearching(node.optionsFilter, node.size),
          ...lookupLabel(node),
          _.get('label.fields', node) && projectStageFromLabelFields(node),
          mapKeywordFilters(node),
          ...sortAndLimitIfSearching(node.optionsFilter, node.size),
        ])
      ),
      search([
        ...unwindPropOrField(node),
        { $group: { _id: `$${node.field}` } },
        { $group: { _id: 1, count: { $sum: 1 } } },
      ]),
    ]).then(([options, cardinality]) => ({
      cardinality: _.get('0.count', cardinality),
      options: _.map(
        ({ _id, label, count }) =>
          F.compactObject({
            name: _id,
            count,
            ...facetValueLabel(node, label),
          }),
        options
      ),
    }))

    let missedValues = _.difference(
      values,
      _.map(
        ({ name }) => (node.isMongoId ? _.toString(name) : name),
        results.options
      )
    )

    let getMissedValues = (node, missedValues) =>
      node.isMongoId ? _.map(ObjectID, missedValues) : missedValues

    if (!_.isEmpty(missedValues)) {
      let MissedResult = await search(
        _.compact([
          {
            $match: { [node.field]: { $in: getMissedValues(node, missedValues)  } },
          },
          { $group: { _id: `$${node.field}`, count: { $sum: 1 } } },
          ...sortAndLimitIfNotSearching(node.optionsFilter, node.size),
          ...lookupLabel(node),
          _.get('label.fields', node) && projectStageFromLabelFields(node),
          mapKeywordFilters(node),
        ])
      )
      // when the value has been selected but filtered by query,the search result will still not contain the checked value. we return it with count 0
      let missedByFilterValues = _.difference(
        //when values are numeric values, stringify missedValues to avoid the bug.
        _.map(_.toString, missedValues),
        _.map(x => _.toString(x[`${node.field}`]), MissedResult)
      )
      let   missedByFilterResult = []

      if (!_.isEmpty(missedByFilterValues)) {
        //use config to run runSearch(options, node, schema, filters, aggs)  function
        missedByFilterResult = await config
          .getProvider(node)
          .runSearch(
            config.options,
            node,
            config.getSchema(node.schema),
            {
              [node.field]: { $in: getMissedValues(node, missedByFilterValues) },
            },
            [
              { $group: { _id: `$${node.field}` } },
              ...lookupLabel(node),
              _.get('label.fields', node) && projectStageFromLabelFields(node),
            ]
          )
      }

      let missedValuesOptions = _.map(
        ({ _id, label, count }) => ({
          name: _id,
          count,
          ...facetValueLabel(node, label),
        }),
        _.flow(
          _.map(({ _id, label }) => ({ _id, label, count: 0 })),
          _.concat(MissedResult)
        )(missedByFilterResult)
      )
      results.options = _.concat(missedValuesOptions, results.options)
    }

    return results
  },
}
