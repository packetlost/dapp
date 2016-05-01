/* globals angular, web3, _ */

angular.module('app').controller('ProductsController', ($scope, $filter, utils, Submarket, helpers, growl, user, Order, constants, Coinage, $stateParams) => {

  const currency = $scope.store.currency

  $scope.store.updatePromise.then(() => {
    $scope.products = $scope.store.products.map((product) => {
      const _product = _.clone(product)
      _product.quantity = 0
      return _product
    })
    $scope.transports = _.clone($scope.store.transports)
    $scope.transport = $scope.transports[0]
  })

  $scope.productsTotal = new Coinage(0, currency)
  $scope.total = new Coinage(0, currency)

  $scope.submarketOptions = [{ addr: constants.nullAddr, label: 'No escrow', escrowFeeCentiperun: 0 }]
  $scope.submarketOption = $scope.submarketOptions[0]

  $scope.createOrder = function createOrder() {

    user.verifyKeypair()

    const buyer = user.getAccount()
    const storeAddr = $scope.store.addr
    const submarketAddr = $scope.submarketOption.addr
    const affiliate = utils.getAffiliate($scope.affiliateCodeOrAlias) || constants.nullAddr
    const transportIndex = $scope.transport.index

    if ($scope.affiliateCodeOrAlias && affiliate === constants.nullAddr) {
      growl.addErrorMessage(`${$scope.affiliateCodeOrAlias} is not a valid affiliate`)
      return
    }

    Order.create(buyer, storeAddr, submarketAddr, affiliate, $scope.products, $scope.transport.index, $scope.total.in('WEI')).then((order) => {
      window.location.hash = `#/orders/${order.addr}`
      user.addOrder(order.addr)
      user.save()
    })

  }

  $scope.getTransportLabel = function getTransportLabel(transport) {
    const userCurrency = user.getCurrency()
    return `${transport.name} (${transport.price.formattedIn(userCurrency)})`
  }

  $scope.quantityChanged = function quantityChanged() {

    $scope.productsTotal = new Coinage(0, currency)

    if (!$scope.products) {
      return
    }

    let productsTotal = web3.toBigNumber(0)

    $scope.products.forEach((product) => {
      const subtotal = product.price.in(currency).times(product.quantity)
      productsTotal = productsTotal.plus(subtotal)
    })

    $scope.productsTotal = new Coinage(productsTotal, currency)

  }

  $scope.$watchGroup(['submarketOption', 'productsTotal', 'transport'], () => {

    console.log('$watch start')


    if (!$scope.transport || !$scope.productsTotal) {
      return
    }

    console.log($scope.productsTotal)

    console.log($scope.productsTotal.in(currency))
    console.log($scope.transport.price.in(currency))
    console.log($scope.submarketOption.escrowFeeCentiperun)

    const fee =
      $scope.productsTotal.in(currency)
        .plus($scope.transport.price.in(currency))
        .times($scope.submarketOption.escrowFeeCentiperun)
        .div(100)

    console.log('$watch1')

    $scope.fee = new Coinage(fee, currency)

    const total =
      $scope.productsTotal.in(currency)
        .plus($scope.transport.price.in(currency))
        .plus(fee)

    console.log('$watch2')

    $scope.total = new Coinage(total, currency)

    console.log('$watch end')
  })

})
