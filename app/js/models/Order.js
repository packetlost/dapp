(function(){

angular.module('app').factory('Order',function(utils,ticker,$q,Store,Market,Key,KeyGroup,PgpMessageWrapper,txMonitor,user){

function Order(addr){
	this.addr = addr
	this.contract = this.contractFactory.at(addr)
	this.updatePromise = this.update()
}

window.Order = Order

Order.prototype.code = Order.code = '0x'+contractDB.Order.compiled.code
Order.prototype.abi = Order.abi = contractDB.Order.compiled.info.abiDefinition
Order.prototype.contractFactory = Order.contractFactory = web3.eth.contract(Order.abi)

Order.create = function(meta,storeAddr,marketAddr,feePercentage,disputeSeconds){

	var deferred = $q.defer()
		,order = this
		,store = new Store(storeAddr)
		,parties = [web3.eth.defaultAccount,store.owner]
		,meta = utils.convertObjectToHex(meta)

	if(marketAddr!==utils.nullAddr){
		var market = new Market(marketAddr)
			,marketOwner = market.owner

		parties.push(marketOwner)
	}

	var keyGroup = new KeyGroup(parties)

	keyGroup.promise.then(function(keyGroup){


		console.log('meta before encryption', meta)

		keyGroup.encrypt(meta).then(function(pgpMessage){
			console.log('meta added', pgpMessage.packets.write())
			var meta = pgpMessage.packets.write()

			txMonitor.propose('Create a New Order',Order.contractFactory,[meta,storeAddr,marketAddr,feePercentage,disputeSeconds,OrderBook.address,{data:order.code}]).then(function(receipt){
				console.log(receipt)
				var order = new Order(receipt.contractAddress)
				deferred.resolve(order)
			})
		},function(error){
			deferred.reject(error)
		})			
			

	},function(error){
		deferred.reject(error)
	})

	return deferred.promise
}

Order.check = function(meta,storeAddr,marketAddr,feePercentage,disputeSeconds){
	utils.check(meta,{
		currency:{
			presence:true
			,type:'string'
			,inclusion:Object.keys(ticker.rates)
		},products:{
			presence:true
			,type:'array'
		},transport:{
			presence:true
			,type:'object'
		}
	})

	meta.products.forEach(function(product){
		utils.check(product,{
			id:{
				presence:true
				,type:'string'
				,numericality:{
					integerOnly:true
					,greaterThanOrEqualTo:0
				}
			},name:{
				presence:true
				,type:'string'
			},price:{
				presence:true
				,type:'string'
				,numericality:{
					greaterThan:0
				}
			},quantity:{
				type:'number'
				,numericality:{
					integerOnly:true
					,greaterThanOrEqualTo:0
				}
			}
		},'Product')
	})

	utils.check(meta.transport,{
		id:{
			presence:true
			,type:'string'
			,numericality:{
				integerOnly:true
				,greaterThanOrEqualTo:0
			}
		},type:{
			presence:true
			,type:'string'
		},price:{
			presence:true
			,type:'string'
			,numericality:{
				greaterThanOrEqualTo:0
			}
		}
	},'Transport')

	utils.check({
		storeAddr:storeAddr
		,marketAddr:marketAddr
		,feePercentage:feePercentage
		,disputeSeconds:disputeSeconds
	},{
		storeAddr:{
			presence:true
			,type:'address'
		},marketAddr:{
			presence:true
			,type:'address'
		},feePercentage:{
			presence:true
			,type:'string'
			,numericality:{
				onlyInteger:true
				,greaterThanOrEqualTo:0
			}
		},disputeSeconds:{
			presence:true
			,type:'number'
			,numericality:{
				onlyInteger:true
				,greaterThanOrEqualTo:0
			}
		}
	})
}

Order.prototype.cancel = function(){
	return txMonitor.propose('Cancel this Order',this.contract.cancel,[])
}

Order.prototype.dispute = function(){
	return txMonitor.propose('Dispute this Order',this.contract.dispute,[])
}

Order.prototype.finalize = function(){
	return txMonitor.propose('Finalize this Order',this.contract.finalize,[])
}

Order.prototype.resolve = function(buyerPercentage){
	return txMonitor.propose('Resolve this Order',this.contract.resolve,[buyerPercentage])
}


Order.prototype.markAsShipped = function(){
	return txMonitor.propose('Mark the Order as Shipped',this.contract.markAsShipped,[])
}

Order.prototype.update = function(){

	var deferred = $q.defer()
		,order = this
		,storeAddr = this.contract.storeAddr()
		,marketAddr = this.contract.marketAddr()

	this.buyer = this.contract.buyer()
	this.store = new Store(storeAddr)
	this.market = marketAddr === utils.nullAddr ? null : new Market(marketAddr)
	this.feePercentage = this.contract.feePercentage()
	this.received = this.contract.received()
	this.status = this.contract.status().toNumber()
	this.timestamp = this.contract.timestamp()
	this.shippedAt = this.contract.shippedAt()
	this.disputeSeconds = this.contract.disputeSeconds()
	this.disputeDeadline = this.disputeSeconds.plus(this.shippedAt)
	this.fee = this.contract.fee()
	this.buyerAmount = this.contract.buyerAmount()
	this.storeOwnerAmount = this.received.minus(this.fee).minus(this.buyerAmount)
	this.buyerPercent = this.buyerAmount.div(this.received.minus(this.fee))
	this.storeOwnerPercent = this.storeOwnerAmount.div(this.received.minus(this.fee))
	this.receivedAtBlockNumber = this.contract.receivedAtBlockNumber()
	this.confirmations = this.receivedAtBlockNumber.minus(web3.eth.blockNumber).times('-1').toNumber()
	this.confirmationsNeeded = this.received.div(web3.toWei(5,'ether')).ceil().toNumber()

	this.messages = []
	this.updates = []
	this.keys = {}
	this.productsTotalInStoreCurrency = new BigNumber(0)

	Key.fetch(this.buyer).then(function(key){
		order.keys.buyer = key
	})

	Key.fetch(this.store.owner).then(function(key){
		order.keys.storeOwner = key
	})

	if(this.market)
		order.market.updatePromise.then(function(market){
			Key.fetch(market.owner).then(function(key){
				order.keys.marketOwner = key
			})
		})

	order.contract.Meta({},{fromBlock: 0, toBlock: 'latest'}).get(function(error,results){

		if(error)
			return deferred.reject(error)

		if(results.length === 0)
			return deferred.reject(new Error('no results found'))

		console.log('meta fetched',web3.toAscii(results[results.length-1].args.meta))

		var metaPgpMessageWrapper = new PgpMessageWrapper(web3.toAscii(results[results.length-1].args.meta))
		
		user.decrypt(metaPgpMessageWrapper)
		
		order.meta = utils.convertHexToObject(metaPgpMessageWrapper.text)

		console.log(order.meta)

		var productsTotalInOrderCurrency = new BigNumber(0)
		order.meta.products.forEach(function(product){
			var subtotal = new BigNumber(product.price).times(product.quantity)
			productsTotalInOrderCurrency = productsTotalInOrderCurrency.plus(subtotal)
		})

		order.productsTotal = utils.convertCurrency(productsTotalInOrderCurrency,{from:order.store.meta.currency,to:'WEI'})
		order.transportPrice = utils.convertCurrency(order.meta.transport.price,{from:order.store.meta.currency,to:'WEI'})
		order.estimatedFee = order.productsTotal.plus(order.transportPrice).times(order.feePercentage).div(100)
		order.total = order.productsTotal.plus(order.transportPrice).plus(order.estimatedFee)
		order.unpaid = order.total.minus(order.received)
		order.percentReceived = new BigNumber(order.received).div(order.total)

		order.contract.Message({},{fromBlock:0,toBlock:'latest'}).get(function(error,results){
			results.forEach(function(result){
				var timestamp = web3.eth.getBlock(result.blockNumber).timestamp
				order.messages.push(new Message(result.args.sender,web3.toAscii(result.args.text),timestamp,order))
			})
		})

		order.contract.Update({},{fromBlock:0,toBlock:'latest'}).get(function(error,results){
			results.forEach(function(result){
				var timestamp = web3.eth.getBlock(result.blockNumber).timestamp
				order.updates.push(new Update(result.args.sender,result.args.status.toNumber(),timestamp,order))
			})

			deferred.resolve(order)
		})

	})


	return deferred.promise

}

Order.prototype.addMessage = function(pgpMessage){
	var ciphertext = pgpMessage.packets.write()
		,deferred = $q.defer()
		,txHex = this.contract.addMessage(ciphertext,{
			gas: this.contract.addMessage.estimateGas(ciphertext)
		})
		,order = this

	utils.waitForTx(txHex).then(function(){
		order.update().then(function(){
			deferred.resolve(order)
		})
	},function(error){
		deferred.reject(error)
	})

	return deferred.promise
}

Order.prototype.withdraw = function(amount){
	console.log(amount.toString(),this.received.toString(),amount.minus(this.received).toString())

	var deferred = $q.defer()
		,txHex = this.contract.withdraw(amount,{
			gas: this.contract.withdraw.estimateGas(amount)*2
		})

	utils.waitForTx(txHex).then(function(){
		deferred.resolve()
	},function(error){
		deferred.reject(error)
	})

	return deferred.promise
}

Order.prototype.decryptMessages = function(privateKey){
	this.messages.forEach(function(message){
		message.decrypt(privateKey)
	})
}

Order.prototype.leaveReview = function(score,text){
	var dataHex = utils.convertObjectToHex({
		text:text
	})

	return txMonitor.propose('Leave a Review',this.store.contract.leaveReview,[this.addr,score,dataHex])
}

function Message(sender,ciphertext,timestamp,order){

	this.sender = sender
	this.ciphertext = ciphertext
	this.timestamp = timestamp

	switch(this.sender){
		case order.buyer:
			this.from = 'buyer'
			break;
		case order.store.owner:
			this.from = 'storeOwner'
			break;
		case order.market.owner:
			this.from = 'marketOwner'
			break;
	}

}

function Update(sender,status,timestamp,order){

	this.sender = sender
	this.status = status
	this.timestamp = timestamp

	switch(this.sender){
		case order.buyer:
			this.from = 'buyer'
			break;
		case order.store.owner:
			this.from = 'storeOwner'
			break;
		case order.marketOwner:
			this.from = 'marketOwner'
			break;
	}
}

Message.prototype.decrypt = function(privateKey){
	this.text = this.pgpMessage.decrypt(privateKey).packets[0].data
}

Update.prototype.isUpdate = true
Update.prototype.isMessage = false
Message.prototype.isUpdate = false
Message.prototype.isMessage = true

return Order

})

})();