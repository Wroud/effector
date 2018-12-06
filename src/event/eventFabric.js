//@flow

// import invariant from 'invariant'
// import warning from 'warning'
import $$observable from 'symbol-observable'
import type {Subscription} from '../effector/index.h'
import type {Event} from './index.h'
import type {Store} from 'effector/store'
import type {Effect} from 'effector/effect'
import {Kind, type kind} from 'effector/stdlib/kind'
import {makeVisitorRecordMap} from 'effector/stdlib/visitor'

import {Step, Cmd} from 'effector/graphite/typedef'
// import type {TypeDef} from 'effector/stdlib/typedef'
import {walkEvent, seq} from 'effector/graphite'
import type {Vertex} from 'effector/graphite/tarjan'
import {eventRefcount} from '../refcount'
import {type CompositeName, createName} from '../compositeName'

import fabric from './concreteFabric'

export function eventFabric<Payload>({
  name: nameRaw,
  parent,
  vertex,
}: {
  name?: string,
  parent?: CompositeName,
  vertex: Vertex<['event', string]>,
}): Event<Payload> {
  const id = eventRefcount()
  const name = nameRaw || id
  const fullName = makeName(name, parent)
  const compositeName = createName(name, parent)
  const graphite = fabric.event({
    fullName,
    runner(payload: Payload): Payload {
      return instanceAsEvent.create(payload, fullName)
    },
  })

  const instance = (payload: Payload): Payload =>
    instanceAsEvent.create(payload, fullName)
  const instanceAsEvent: Event<Payload> = (instance: any)
  instanceAsEvent.graphite = graphite

  Object.defineProperty((instance: any), 'toString', {
    configurable: true,
    value() {
      return compositeName.fullName
    },
  })
  instance.getType = instance.toString
  ;(instance: any).create = (payload, fullName) => {
    walkEvent(payload, instanceAsEvent)
    return payload
  }
  ;(instance: any).kind = Kind.event
  ;(instance: any)[$$observable] = () => instance
  instance.id = id
  instance.watch = watch
  instance.map = map
  instance.prepend = prepend
  instance.subscribe = subscribe
  instance.to = to
  instance.shortName = name
  instance.domainName = parent
  instance.compositeName = compositeName
  instance.filter = filter
  instance.getNode = () => vertex
  function filter<Next>(fn: Payload => Next | void): Event<Next> {
    return filterEvent(instanceAsEvent, fn)
  }

  function map<Next>(fn: Payload => Next): Event<Next> {
    return mapEvent(instanceAsEvent, fn)
  }
  const visitors = makeVisitorRecordMap({
    to: {
      visitor: {
        store: (target, handler) =>
          watch(payload => target.setState(payload, handler)),
        event: (target, handler) => watch(target.create),
        effect: (target, handler) => watch(target.create),
        none(target, handler) {
          throw new TypeError('Unsupported kind')
        },
      },
      reader: target => ((target.kind: any): kind),
      writer: (handler, target, handlerFn) => handler(target, handlerFn),
    },
  })
  function to(
    target: Store<any> & Event<any> & Effect<any, any, any>,
    handler?: Function,
  ): Subscription {
    return visitors.to(target, handler)
  }

  function watch(
    watcher: (payload: Payload, type: string) => any,
  ): Subscription {
    return watchEvent(instanceAsEvent, watcher)
  }

  function subscribe(observer): Subscription {
    return watch(payload => observer.next(payload))
  }
  function prepend<Before>(fn: Before => Payload) {
    const vert = vertex.createChild(['event', `* → ${name}`])
    const contramapped: Event<Before> = eventFabric({
      name: `* → ${name}`,
      parent,
      vertex: vert,
    })
    fabric.prependEvent({
      fn,
      graphite: contramapped.graphite,
      parentGraphite: graphite,
    })
    return contramapped
  }

  return (instance: $todo)
}

declare function mapEvent<A, B>(event: Event<A>, fn: (_: A) => B): Event<B>
declare function mapEvent<A, B>(
  effect: Effect<A, any, any>,
  fn: (_: A) => B,
): Event<B>
function mapEvent<A, B>(event: Event<A> | Effect<A, any, any>, fn: A => B) {
  const vertex = event.getNode()
  const mapped = eventFabric({
    name: `${event.shortName} → *`,
    parent: event.domainName,
    vertex: vertex.createChild(['event', `${event.shortName} → *`]),
  })
  fabric.mapEvent({
    fn,
    graphite: mapped.graphite,
    parentGraphite: event.graphite,
  })
  return mapped
}

function filterEvent<A, B>(
  event: Event<A> | Effect<A, any, any>,
  fn: A => B | void,
): Event<B> {
  const vertex = event.getNode()
  const mapped = eventFabric({
    name: `${event.shortName} →? *`,
    parent: event.domainName,
    vertex: vertex.createChild(['event', `${event.shortName} →? *`]),
  })
  fabric.filterEvent({
    fn,
    graphite: mapped.graphite,
    parentGraphite: event.graphite,
  })
  return mapped
}
export function watchEvent<Payload>(
  event: Event<Payload>,
  watcher: (payload: Payload, type: string) => any,
): Subscription {
  const singleCmd = Step.single(
    Cmd.run({
      runner(newValue: Payload) {
        return watcher(newValue, event.getType())
      },
    }),
  )
  const sq = seq[1]()
  let runCmd
  let isWrited = false
  if (sq !== null) {
    if (sq.data.length > 0) {
      const last = sq.data[sq.data.length - 1]
      if (last.type === ('multi': 'multi')) {
        last.data.push(singleCmd)
      } else {
        sq.data.push(singleCmd)
      }
      isWrited = true
    }
    runCmd = isWrited ? sq : Step.seq(sq.data.concat([singleCmd]))
  } else runCmd = singleCmd
  event.graphite.next.data.push(runCmd)
  const unsubscribe = () => {
    const i = event.graphite.next.data.indexOf(runCmd)
    if (i === -1) return

    event.graphite.next.data.splice(i, 1)
  }
  unsubscribe.unsubscribe = unsubscribe
  return unsubscribe
}
function makeName(name: string, compositeName?: CompositeName) {
  return [compositeName?.fullName, name].filter(Boolean).join('/')
}
