/* globals angular, contracts, web3 */

angular.module('app').factory('Store', ($q, utils, ticker, Key, txMonitor, AliasReg, StoreReg, Infosphered, Meta, Coinage, constants, filestore, user) => {

  function Store(addrOrAlias) {
    this.addr = utils.isAddr(addrOrAlias) ? addrOrAlias : AliasReg.getAddr(addrOrAlias)
    this.alias = utils.getAlias(this.addr)
    this.contract = this.contractFactory.at(this.addr)
    this.infosphered = new Infosphered(this.contract, {
      isOpen: 'bool',
      currency: 'bytes32',
      bufferCentiperun: 'uint',
      disputeSeconds: 'uint',
      minTotal: 'uint',
      affiliateFeeCentiperun: 'uint',
      fileHash: 'bytes32'
    })
    this.updatePromise = this.update()
  }

  Store.prototype.bytecode = Store.bytecode = contracts.Store.bytecode
  Store.prototype.runtimeBytecode = Store.runtimeBytecode = utils.runtimeBytecodes.Store
  Store.prototype.abi = Store.abi = contracts.Store.abi
  Store.prototype.contractFactory = Store.contractFactory = web3.eth.contract(Store.abi)

  Store.create = function createStore(
    owner,
    isOpen,
    currency,
    bufferCentiperun,
    disputeSeconds,
    minTotal,
    affiliateFeeCentiperun,
    meta,
    alias
  ) {

    const file = utils.convertObjectToHex(meta)
    const aliasHex = web3.toHex(alias)
    const fileHash = utils.sha3(file, { encoding: 'hex' })
    const deferred = $q.defer()

    const calls = filestore.getMartyrCalls([file])

    calls.push({
      address: StoreReg.address,
      data: StoreReg.create.getData(
        owner,
        isOpen,
        currency,
        bufferCentiperun,
        disputeSeconds,
        minTotal,
        affiliateFeeCentiperun,
        fileHash,
        aliasHex
      )
    })

    const martyrData = utils.getMartyrData(calls)

    txMonitor.propose(
      'Create a New Store',
      web3.eth.sendTransaction,
      [{ data: martyrData }]
    ).then((txReciept) => {
      const contractAddress = utils.getContractAddressFromTxReceipt(txReciept)
      deferred.resolve(new Store(contractAddress))
    })

    return deferred.promise

  }

  Store.prototype.set = function setStore(infospheredData, meta, productsData, transportsData) {

    const deferred = $q.defer()

    const metaCalls = []
    const file = utils.convertObjectToHex(meta)
    const fileHash = utils.sha3(file)

    infospheredData.fileHash = fileHash
    console.log('fileHash', fileHash)

    const infospheredCalls = this.infosphered.getMartyrCalls(infospheredData)

    console.log('infospheredCalls', infospheredCalls)

    if (this.infosphered.data.fileHash !== fileHash) {
      metaCalls.push.apply(metaCalls, filestore.getMartyrCalls([file]))
    }

    const productCalls = this.getProductMartyrCalls(productsData)
    const transportCalls = this.getTransportMartyrCalls(transportsData)
    const allCalls = infospheredCalls.concat(metaCalls).concat(productCalls).concat(transportCalls)
    const data = utils.getMartyrData(allCalls)

    txMonitor.propose('Update Store', web3.eth.sendTransaction, [{
      data: data,
      gas: web3.eth.estimateGas({ data: data }) * 4
    }]).then((txReciept) => {
      deferred.resolve(txReciept)
    }, (err) => {
      deferred.reject(err)
    })


    return deferred.promise
  }

  Store.check = function checkStore(alias, meta) {

    utils.check({ alias: alias }, {
      alias: {
        presence: true,
        type: 'alias'
      }
    })

    utils.check(meta, {
      name: {
        presence: true,
        type: 'string'
      }, info: {
        type: 'string'
      }
    })

  }

  Store.estimateCreationGas = function estimateStoreCreationGas(alias, meta) {
    meta = typeof meta === 'string' ? meta : utils.convertObjectToHex(meta)

    return this.contractFactory.estimateGas(alias, meta, AliasReg.address, {
      data: Store.bytecode
    }) + AliasReg.claimAlias.estimateGas(alias)
  }


  Store.prototype.update = function update() {

    const deferred = $q.defer()
    const store = this

    console.log(this)

    this.scoreCounts = []
    this.scoreCountsReversed = []
    this.scoreCountsSum = 0
    this.scoreCountsTotal = 0
    this.owner = this.contract.owner()
    this.key = new Key(this.owner)

    this.infosphered.update()
    this.currency = utils.toAscii(this.infosphered.data.currency)

    this.products = this.getProducts()
    this.transports = this.getTransports()
    this.reviews = []

    this.minTotal = new Coinage(this.infosphered.data.minTotal.div(constants.tera), this.currency)

    filestore.fetchFile(this.infosphered.data.fileHash).then((file) => {
      this.file = file
      this.meta = utils.convertHexToObject(file)
      store.info = utils.sanitize(this.meta.info || '')
      deferred.resolve(store)
    }, (err) => {
      deferred.reject(err)
    })

    return deferred.promise
  }

  Store.prototype.getProducts = function getStoreProducts() {

    const products = []
    const productsLength = this.contract.getProductsLength()

    for (let i = 0; i < productsLength; i++) {
      products.push(new Product(this, i))
    }

    return products
  }

  Store.prototype.getProductMartyrCalls = function getProductMartyrCalls(productsData) {
    console.log(productsData)

    const calls = []

    productsData.forEach((productData) => {

      if (productData.index === undefined) {
        calls.push.apply(calls, this.getAddProductMartyrCalls(productData))
      } else {
        calls.push.apply(calls, this.getSetProductMartyrCalls(productData))
      }
    })

    console.log(calls)

    return calls
  }

  Store.prototype.getAddProductMartyrCalls = function getAddProductMartyrCalls(productData) {

    console.log('add product', productData)

    const teraprice = productData.price.in(this.currency).times(constants.tera)
    const file = this.getProductFile(productData)
    const fileHash = utils.sha3(file)

    console.log(teraprice, fileHash)

    return filestore.getMartyrCalls([file]).concat([{
      address: this.contract.address,
      data: this.contract.addProduct.getData(teraprice, fileHash)
    }])

  }

  Store.prototype.getSetProductMartyrCalls = function getSetProductMartyrCalls(productData) {

    console.log('set product productData', productData)

    const product = new Product(this, productData.index)
    const teraprice = productData.price.in(this.currency).times(constants.tera)
    const file = this.getProductFile(productData)
    const fileHash = utils.sha3(file)

    const calls = []

    console.log(product, teraprice, file, fileHash)

    if (product.isArchived !== productData.isArchived) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setProductIsArchived.getData(productData.index, productData.isArchived)
      })
    }

    if (!product.teraprice.equals(teraprice)) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setProductTeraprice.getData(productData.index, teraprice)
      })
    }

    console.log(product.teraprice)

    if (product.fileHash !== fileHash) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setProductFileHash.getData(productData.index, fileHash)
      })
      console.log('filestore martyr calls', filestore.getMartyrCalls([file]))
      calls.push.apply(calls, filestore.getMartyrCalls([file]))
    }

    console.log('set product', calls)

    return calls

  }

  Store.prototype.getProductFile = function getProductFile(productData) {
    return utils.convertObjectToHex({
      name: productData.name,
      info: productData.info,
      img: productData.img
    })
  }

  Store.prototype.getTransports = function getStoreTransports() {

    const transports = []
    const transportsLength = this.contract.getTransportsLength()

    for (let i = 0; i < transportsLength; i++) {
      transports.push(new Transport(this, i))
    }

    return transports
  }

  Store.prototype.getTransportMartyrCalls = function getTransportMartyrCalls(transportsData) {

    const calls = []

    transportsData.forEach((transportData) => {

      if (transportData.index === undefined) {
        calls.push.apply(calls, this.getAddTransportMartyrCalls(transportData))
      } else {
        calls.push.apply(calls, this.getSetTransportMartyrCalls(transportData))
      }
    })

    console.log(calls)

    return calls
  }

  Store.prototype.getAddTransportMartyrCalls = function getAddTransportMartyrCalls(transportData) {

    console.log('add transport', transportData)

    const teraprice = transportData.price.in(this.currency).times(constants.tera)
    const file = this.getTransportFile(transportData)
    const fileHash = utils.sha3(file)

    console.log(teraprice, fileHash)

    return filestore.getMartyrCalls([file]).concat([{
      address: this.contract.address,
      data: this.contract.addTransport.getData(teraprice, fileHash)
    }])

  }

  Store.prototype.getSetTransportMartyrCalls = function getSetTransportMartyrCalls(transportData) {

    console.log('set transport transportData', transportData)

    const transport = new Transport(this, transportData.index)
    const teraprice = transportData.price.in(this.currency).times(constants.tera)
    const file = this.getTransportFile(transportData)
    const fileHash = utils.sha3(file)

    const calls = []

    console.log(transport, teraprice, file, fileHash)

    if (transport.isArchived !== transportData.isArchived) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setTransportIsArchived.getData(transportData.index, transportData.isArchived)
      })
    }

    if (!transport.teraprice.equals(teraprice)) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setTransportTeraprice.getData(transportData.index, teraprice)
      })
    }

    console.log(transport.teraprice)

    if (transport.fileHash !== fileHash) {
      calls.push({
        address: this.contract.address,
        data: this.contract.setTransportFileHash.getData(transportData.index, fileHash)
      })
      console.log('filestore martyr calls', filestore.getMartyrCalls([file]))
      calls.push.apply(calls, filestore.getMartyrCalls([file]))
    }

    console.log('set transport', calls)

    return calls

  }

  Store.prototype.getTransportFile = function getTransportFile(transportData) {
    return utils.convertObjectToHex({
      name: transportData.name
    })
  }

  function Review(result, store) {
    this.data = utils.convertHexToObject(result.args.data)
    this.orderAddr = result.args.orderAddr

    const reviewData = store.contract.getReview(result.args.orderAddr)
    this.score = reviewData[0].toNumber()
    this.timestamp = reviewData[1].toNumber()
  }

  function Product(store, index) {
    this.store = store
    this.index = index
    this.updatePromise = this.update()
    this.quantity = 0
  }

  Product.prototype.update = function update() {
    const deferred = $q.defer()
    this.isArchived = this.store.contract.getProductIsArchived(this.index)
    this.teraprice = this.store.contract.getProductTeraprice(this.index)
    this.price = new Coinage(this.teraprice.div(constants.tera), this.store.currency)
    this.fileHash = this.store.contract.getProductFileHash(this.index)
    filestore.fetchFile(this.fileHash).then((file) => {
      this.file = file
      const data = utils.convertHexToObject(file)
      this.name = data.name
      this.info = data.info
      this.img = data.img
      deferred.resolve(this)
    })
    return deferred.promise
  }

  function Transport(store, index) {
    this.store = store
    this.index = index
    this.updatePromise = this.update()
    this.quantity = 0
  }

  Transport.prototype.update = function update() {
    const deferred = $q.defer()
    this.isArchived = this.store.contract.getTransportIsArchived(this.index)
    this.teraprice = this.store.contract.getTransportTeraprice(this.index)
    this.price = new Coinage(this.teraprice.div(constants.tera), this.store.currency)
    this.fileHash = this.store.contract.getTransportFileHash(this.index)
    filestore.fetchFile(this.fileHash).then((file) => {
      this.file = file
      const data = utils.convertHexToObject(file)
      this.name = data.name
      deferred.resolve(this)
    })
    return deferred.promise
  }

  return Store

})
