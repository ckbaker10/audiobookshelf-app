// SOURCE: https://stackoverflow.com/a/69617795/7431543
export default class TouchEvent {
    static SWPIE_THRESHOLD = 50 // Minumum difference in pixels at which a swipe gesture is detected

    static SWIPE_LEFT = 1
    static SWIPE_RIGHT = 2
    static SWIPE_UP = 3
    static SWIPE_DOWN = 4

    constructor(startEvent, endEvent) {
        this.startEvent = startEvent
        this.endEvent = endEvent || null
    }

    isSwipeLeft() {
        return this.getSwipeDirection() == TouchEvent.SWIPE_LEFT
    }

    isSwipeRight() {
        return this.getSwipeDirection() == TouchEvent.SWIPE_RIGHT
    }

    isSwipeUp() {
        return this.getSwipeDirection() == TouchEvent.SWIPE_UP
    }

    isSwipeDown() {
        return this.getSwipeDirection() == TouchEvent.SWIPE_DOWN
    }

    getSwipeDirection() {
        // The end event is optional by design: the constructor's second argument defaults to null
        // and setEndEvent() exists to supply it later, so "started but not yet ended" is a normal
        // state. The guard below used to sit *after* these dereferences, which meant it could only
        // ever catch an empty touch list - a missing end event threw instead.
        if (!this.startEvent || !this.endEvent) {
            return null
        }

        let start = this.startEvent.changedTouches[0]
        let end = this.endEvent.changedTouches[0]

        if (!start || !end) {
            return null
        }

        let horizontalDifference = start.screenX - end.screenX
        let verticalDifference = start.screenY - end.screenY

        // Horizontal difference dominates
        if (Math.abs(horizontalDifference) > Math.abs(verticalDifference)) {
            if (horizontalDifference >= TouchEvent.SWPIE_THRESHOLD) {
                return TouchEvent.SWIPE_LEFT
            } else if (horizontalDifference <= -TouchEvent.SWPIE_THRESHOLD) {
                return TouchEvent.SWIPE_RIGHT
            }

            // Verical or no difference dominates
        } else {
            if (verticalDifference >= TouchEvent.SWPIE_THRESHOLD) {
                return TouchEvent.SWIPE_UP
            } else if (verticalDifference <= -TouchEvent.SWPIE_THRESHOLD) {
                return TouchEvent.SWIPE_DOWN
            }
        }

        return null
    }

    setEndEvent(endEvent) {
        this.endEvent = endEvent
    }
}