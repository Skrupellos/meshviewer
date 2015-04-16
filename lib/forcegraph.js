define(["d3"], function (d3) {
  var margin = 200
  var NODE_RADIUS = 15
  var LINE_RADIUS = 12

  return function (config, linkScale, sidebar, router) {
    var self = this
    var canvas, ctx, screenRect
    var nodesDict, linksDict
    var zoomBehavior
    var force
    var el
    var doAnimation = false
    var intNodes = []
    var intLinks = []
    var highlight
    var highlightedNodes = []
    var highlightedLinks = []
    var nodes = []
    var unknownNodes = []

    var draggedNode

    var LINK_DISTANCE = 70

    function graphDiameter(nodes) {
      return Math.sqrt(nodes.length / Math.PI) * LINK_DISTANCE * 1.41
    }

    function savePositions() {
      if (!localStorageTest())
        return

      var save = intNodes.map( function (d) {
        return { id: d.o.id, x: d.x, y: d.y }
      })

      localStorage.setItem("graph/nodeposition", JSON.stringify(save))
    }

    function nodeName(d) {
      if (d.o.node && d.o.node.nodeinfo)
        return d.o.node.nodeinfo.hostname
      else
        return d.o.id
    }

    function dragstart() {
      var e = translateXY(d3.mouse(el))

      var nodes = intNodes.filter(function (d) {
        return distancePoint(e, d) < NODE_RADIUS
      })

      if (nodes.length === 0)
        return

      draggedNode = nodes[0]
      d3.event.sourceEvent.stopPropagation()
      d3.event.sourceEvent.preventDefault()
      draggedNode.fixed |= 2
    }

    function dragmove() {
      if (draggedNode) {
        var e = translateXY(d3.mouse(el))

        draggedNode.px = e.x
        draggedNode.py = e.y
        force.resume()
      }
    }

    function dragend() {
      if (draggedNode) {
        d3.event.sourceEvent.stopPropagation()
        d3.event.sourceEvent.preventDefault()
        draggedNode.fixed &= 1
        draggedNode = undefined
      }
    }

    var draggableNode = d3.behavior.drag()
                          .on("dragstart", dragstart)
                          .on("drag", dragmove)
                          .on("dragend", dragend)

    function animatePanzoom(translate, scale) {
      var translateP = zoomBehavior.translate()
      var scaleP = zoomBehavior.scale()

      if (!doAnimation) {
        zoomBehavior.translate(translate)
        zoomBehavior.scale(scale)
        panzoom()
      } else {
        var start = {x: translateP[0], y: translateP[1], scale: scaleP}
        var end = {x: translate[0], y: translate[1], scale: scale}

        var interpolate = d3.interpolateObject(start, end)
        var duration = 500

        var ease = d3.ease("cubic-in-out")

        d3.timer(function (t) {
          if (t >= duration)
            return true

          var v = interpolate(ease(t / duration))
          zoomBehavior.translate([v.x, v.y])
          zoomBehavior.scale(v.scale)
          panzoom()

          return false
        })
      }
    }

    var translateP, scaleP

    function panzoom() {
      var translate = zoomBehavior.translate()
      var scale = zoomBehavior.scale()


      panzoomReal(translate, scale)

      translateP = translate
      scaleP = scale
    }

    function panzoomReal(translate, scale) {
      screenRect = {left: -translate[0] / scale, top: -translate[1] / scale,
                    right: (canvas.width - translate[0]) / scale,
                    bottom: (canvas.height - translate[1]) / scale}

      redraw()
    }

    function getSize() {
      var sidebarWidth = sidebar.getWidth()
      var width = el.offsetWidth - sidebarWidth
      var height = el.offsetHeight

      return [width, height]
    }

    function panzoomTo(a, b) {
      var sidebarWidth = sidebar.getWidth()
      var size = getSize()

      var targetWidth = Math.max(1, b[0] - a[0])
      var targetHeight = Math.max(1, b[1] - a[1])

      var scaleX = size[0] / targetWidth
      var scaleY = size[1] / targetHeight
      var scaleMax = zoomBehavior.scaleExtent()[1]
      var scale = 0.5 * Math.min(scaleMax, Math.min(scaleX, scaleY))

      var centroid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      var x = -centroid[0] * scale + size[0] / 2
      var y = -centroid[1] * scale + size[1] / 2
      var translate = [x + sidebarWidth, y]

      animatePanzoom(translate, scale)
    }

    function updateHighlight(nopanzoom) {
      highlightedNodes = []
      highlightedLinks = []

      if (highlight !== undefined)
        if (highlight.type === "node") {
          var n = nodesDict[highlight.o.nodeinfo.node_id]

          if (n) {
            highlightedNodes = [n]

            if (!nopanzoom)
              panzoomTo([n.x, n.y], [n.x, n.y])
          }

          return
        } else if (highlight.type === "link") {
          var l = linksDict[highlight.o.id]

          if (l) {
            highlightedLinks = [l]
            highlightedNodes = [l.source, l.target]

            if (!nopanzoom) {
              var x = d3.extent([l.source, l.target], function (d) { return d.x })
              var y = d3.extent([l.source, l.target], function (d) { return d.y })
              panzoomTo([x[0], y[0]], [x[1], y[1]])
            }
          }

          return
        }

      if (!nopanzoom)
        panzoomTo([0, 0], force.size())
    }

    function drawLabel(mipmap) {
      var mipscale = 1 / Math.pow(2, mipmap)
      var h = (Math.pow(2, mipmap) - 1) / Math.pow(2, mipmap - 1)

      return function (d) {
        var sum = d.neighbours.reduce(function (a, b) {
          return [a[0] + b.x, a[1] + b.y]
        }, [0, 0])

        var sumCos = sum[0] - d.x * d.neighbours.length
        var sumSin = sum[1] - d.y * d.neighbours.length

        var angle = Math.PI / 2

        if (d.neighbours.length > 0)
          angle = Math.PI + Math.atan2(sumSin, sumCos)

        var cos = Math.cos(angle)
        var sin = Math.sin(angle)

        var width = d.labelWidth
        var height = d.labelHeight
        var dstWidth = width / d.labelScale
        var dstHeight = height / d.labelScale

        var x = d.x + d.labelA * Math.pow(Math.abs(cos), 2 / 5) * Math.sign(cos) - dstWidth / 2
        var y = d.y + d.labelB * Math.pow(Math.abs(sin), 2 / 5) * Math.sign(sin) - dstHeight / 2

        ctx.drawImage(d.label, 0, h * height, width * mipscale, height * mipscale, x, y, dstWidth, dstHeight)
      }
    }

    function visibleLinks(d) {
      return (d.source.x > screenRect.left && d.source.x < screenRect.right &&
              d.source.y > screenRect.top && d.source.y < screenRect.bottom) ||
             (d.target.x > screenRect.left && d.target.x < screenRect.right &&
              d.target.y > screenRect.top && d.target.y < screenRect.bottom)
    }

    function visibleNodes(d) {
      return d.x + margin > screenRect.left && d.x - margin < screenRect.right &&
             d.y + margin > screenRect.top && d.y - margin < screenRect.bottom
    }

    function redraw() {
      var translate = zoomBehavior.translate()
      var scale = zoomBehavior.scale()
      var scaleExtent = zoomBehavior.scaleExtent()
      var links = intLinks.filter(visibleLinks)
      var mipmap = (Math.floor(scaleExtent[1] / scale) - 1).valueOf()

      var xExtent = d3.extent(intNodes, function (d) { return d.px })
      var yExtent = d3.extent(intNodes, function (d) { return d.py })

      if (translateP) {
        ctx.save()
        ctx.translate(translateP[0], translateP[1])
        ctx.scale(scaleP, scaleP)
        ctx.clearRect(xExtent[0] - margin, yExtent[0] - margin,
                      xExtent[1] - xExtent[0] + 2 * margin,
                      yExtent[1] - yExtent[0] + 2 * margin)
        ctx.restore()
      }

      ctx.save()
      ctx.translate(translate[0], translate[1])
      ctx.scale(scale, scale)

      if (!translateP)
        ctx.clearRect(xExtent[0] - margin, yExtent[0] - margin,
                      xExtent[1] - xExtent[0] + 2 * margin,
                      yExtent[1] - yExtent[0] + 2 * margin)

      if (highlightedLinks.length) {
        ctx.save()
        ctx.lineWidth = 10
        ctx.strokeStyle = "#FFD486"

        highlightedLinks.forEach(function (d) {
          ctx.beginPath()
          ctx.moveTo(d.source.x, d.source.y)
          ctx.lineTo(d.target.x, d.target.y)
          ctx.stroke()
        })

        ctx.restore()
      }

      ctx.lineWidth = 2.5

      links.forEach(function (d) {
        ctx.beginPath()
        ctx.moveTo(d.source.x, d.source.y)
        ctx.lineTo(d.target.x, d.target.y)
        ctx.strokeStyle = d.color
        ctx.stroke()
      })

      var f = drawLabel(mipmap)
      intNodes.filter(visibleNodes).forEach(f)

      ctx.beginPath()

      unknownNodes.filter(visibleNodes).forEach(function (d) {
        ctx.moveTo(d.x + 8, d.y)
        ctx.arc(d.x, d.y, 8, 0, 2 * Math.PI)
      })

      ctx.strokeStyle = "#d00000"
      ctx.fillStyle = "#ffffff"

      ctx.fill()
      ctx.stroke()

      ctx.beginPath()
      nodes.filter(visibleNodes).forEach(function (d) {
        ctx.moveTo(d.x + 8, d.y)
        ctx.arc(d.x, d.y, 8, 0, 2 * Math.PI)
      })

      ctx.strokeStyle = "#AEC7E8"
      ctx.fillStyle = "#ffffff"

      ctx.fill()
      ctx.stroke()

      if (highlightedNodes.length) {
        ctx.save()
        ctx.strokeStyle = "#FFD486"
        ctx.fillStyle = "orange"
        ctx.lineWidth = 6

        highlightedNodes.forEach(function (d) {
          ctx.beginPath()
          ctx.moveTo(d.x + 8, d.y)
          ctx.arc(d.x, d.y, 8, 0, 2 * Math.PI)
          ctx.fill()
          ctx.stroke()
        })

        ctx.restore()
      }

      ctx.restore()
    }

    function tickEvent() {
      redraw()
    }

    function resizeCanvas() {
      var r = window.devicePixelRatio
      canvas.width = el.offsetWidth * r
      canvas.height = el.offsetHeight * r
      canvas.style.width = el.offsetWidth + "px"
      canvas.style.height = el.offsetHeight + "px"
      ctx.resetTransform()
      ctx.scale(r, r)
      redraw()
    }

    function distance(a, b) {
      return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)
    }

    function distancePoint(a, b) {
      return Math.sqrt(distance(a, b))
    }

    function distanceLink(p, a, b) {
      /* http://stackoverflow.com/questions/849211 */

      var l2 = distance(a, b)

      if (l2 === 0)
        return distance(p, a)

      var t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2

      if (t < 0)
        return distance(p, a)

      if (t > 1)
        return distance(p, b)

      return Math.sqrt(distance(p, { x: a.x + t * (b.x - a.x),
                                     y: a.y + t * (b.y - a.y) }))
    }

    function translateXY(d) {
      var translate = zoomBehavior.translate()
      var scale = zoomBehavior.scale()

      return {x: (d[0] - translate[0]) / scale,
              y: (d[1] - translate[1]) / scale
             }
    }

    function onClick() {
      if (d3.event.defaultPrevented)
        return

      var e = translateXY(d3.mouse(el))

      var nodes = intNodes.filter(function (d) {
        return distancePoint(e, d) < NODE_RADIUS
      })

      if (nodes.length > 0) {
        router.node(nodes[0].o.node)()
        return
      }

      var links = intLinks.filter(function (d) {
        return distanceLink(e, d.source, d.target) < LINE_RADIUS
      })

      if (links.length > 0) {
        router.link(links[0].o)()
        return
      }
    }

    el = document.createElement("div")
    el.classList.add("graph")
    self.div = el

    zoomBehavior = d3.behavior.zoom()
                     .scaleExtent([1 / 3, 3])
                     .on("zoom", panzoom)
                     .translate([sidebar.getWidth(), 0])

    canvas = d3.select(el)
               .call(zoomBehavior)
               .append("canvas")
               .attr("pointer-events", "all")
               .on("click", onClick)
               .call(draggableNode)
               .node()

    ctx = canvas.getContext("2d")

    force = d3.layout.force()
              .charge(-80)
              .gravity(0.01)
              .chargeDistance(8 * LINK_DISTANCE)
              .linkDistance(LINK_DISTANCE)
              .linkStrength(function (d) {
                return Math.max(0.5, 1 / d.o.tq)
              })
              .on("tick", tickEvent)
              .on("end", savePositions)

    window.addEventListener("resize", resizeCanvas)

    panzoom()

    self.setData = function (data) {
      var oldNodes = {}

      intNodes.forEach( function (d) {
        oldNodes[d.o.id] = d
      })

      intNodes = data.graph.nodes.map( function (d) {
        var e
        if (d.id in oldNodes)
          e = oldNodes[d.id]
        else
          e = {}

        e.o = d

        return e
      })

      var newNodesDict = {}

      intNodes.forEach( function (d) {
        newNodesDict[d.o.id] = d
      })

      var oldLinks = {}

      intLinks.forEach( function (d) {
        oldLinks[d.o.id] = d
      })

      intLinks = data.graph.links.filter( function (d) {
        return !d.vpn
      }).map( function (d) {
        var e
        if (d.id in oldLinks)
          e = oldLinks[d.id]
        else
          e = {}

        e.o = d
        e.source = newNodesDict[d.source.id]
        e.target = newNodesDict[d.target.id]
        e.color = linkScale(d.tq).hex()

        return e
      })

      linksDict = {}
      nodesDict = {}

      intNodes.forEach(function (d) {
        d.neighbours = {}

        if (d.o.node)
          nodesDict[d.o.node.nodeinfo.node_id] = d

        var name = nodeName(d)

        ctx.font = "11px Roboto"
        var offset = 8
        var lineWidth = 3
        var width = ctx.measureText(name).width
        var buffer = document.createElement("canvas")
        var r = window.devicePixelRatio
        var bctx = buffer.getContext("2d")
        var scale = zoomBehavior.scaleExtent()[1] * r
        width = (width + 2 * lineWidth) * scale
        var height = (13 + 2 * lineWidth) * scale
        var copies = zoomBehavior.scaleExtent()[1] / zoomBehavior.scaleExtent()[0]
        buffer.width = width
        buffer.height = 2 * height

        bctx.textBaseline = "top"
        bctx.textAlign = "left"
        bctx.font = ctx.font
        bctx.lineWidth = lineWidth
        bctx.lineCap = "round"
        bctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
        bctx.fillStyle = "rgba(0, 0, 0, 0.6)"

        for (var i = 0; i <= copies; i++) {
          var h = (Math.pow(2, i) - 1) / Math.pow(2, i - 1)
          bctx.save()
          bctx.translate(0, h * height)
          bctx.scale(scale / Math.pow(2, i), scale / Math.pow(2, i))
          bctx.strokeText(name, lineWidth, lineWidth)
          bctx.fillText(name, lineWidth, lineWidth)
          bctx.restore()
        }

        d.label = buffer
        d.labelScale = scale
        d.labelWidth = width
        d.labelHeight = height
        d.labelA = offset + width / (2 * scale)
        d.labelB = offset + height / (2 * scale)
      })

      intLinks.forEach(function (d) {
        d.source.neighbours[d.target.o.id] = d.target
        d.target.neighbours[d.source.o.id] = d.source

        if (d.o.source.node && d.o.target.node)
          linksDict[d.o.id] = d
      })

      intNodes.forEach(function (d) {
        d.neighbours = Object.keys(d.neighbours).map(function (k) {
          return d.neighbours[k]
        })
      })

      nodes = intNodes.filter(function (d) { return d.o.node })
      unknownNodes = intNodes.filter(function (d) { return !d.o.node })

      if (localStorageTest()) {
        var save = JSON.parse(localStorage.getItem("graph/nodeposition"))

        if (save) {
          var nodePositions = {}
          save.forEach( function (d) {
            nodePositions[d.id] = d
          })

          intNodes.forEach( function (d) {
            if (nodePositions[d.o.id] && (d.x === undefined || d.y === undefined)) {
              d.x = nodePositions[d.o.id].x
              d.y = nodePositions[d.o.id].y
            }
          })
        }
      }

      var diameter = graphDiameter(intNodes)

      force.nodes(intNodes)
           .links(intLinks)
           .size([diameter, diameter])

      updateHighlight(true)

      force.start()
      resizeCanvas()
    }

    self.resetView = function () {
      highlight = undefined
      updateHighlight()
      doAnimation = true
    }

    self.gotoNode = function (d) {
      highlight = {type: "node", o: d}
      updateHighlight()
      doAnimation = true
    }

    self.gotoLink = function (d) {
      highlight = {type: "link", o: d}
      updateHighlight()
      doAnimation = true
    }

    self.destroy = function () {
      force.stop()
      canvas.remove()
      force = null
    }

    return self
  }
})
