// The mechanics of a step.
//
// Pure geometry: no canvas, no state, no time. Everything here is a function of
// where a leg is in its cycle, which is a function of ground covered — so this
// file can be tested headlessly, and the feet can be *proved* not to slide
// rather than eyeballed.
//
// The model, in one paragraph. A walking foot is not a pendulum swinging under
// a body; it is planted on the floor for most of the cycle while the body
// travels over it, then whipped forward through the air to the next plant. That
// is the whole difference between walking and skating, and the old code did not
// have it: the foot's offset was `sin(phase)`, which never stops moving, so at
// every instant the foot was travelling at the body's speed *plus* whatever the
// sine was doing. Here the stance foot moves backwards through the body's frame
// at exactly the body's speed, which means it does not move at all across the
// floor. Sliding is not reduced, it is arithmetically absent.
//
// Everything else falls out of that one decision:
//
//   * The pelvis height is *derived* from the legs rather than tuned. A planted
//     foot and a fixed leg length between them leave exactly one height the hips
//     can be at, so the body dips as the legs splay and rises over the support
//     leg. That gives the correct two-dips-per-cycle bob for free, in the
//     correct phase — the hand-tuned sine it replaces was upside down.
//   * The knee comes from two-bone inverse kinematics, so it is straight when
//     the leg is extended at contact and folded when the foot is up under the
//     hip. The old ad-hoc bend was also upside down: it bent the knee hardest
//     when the leg was reaching forward, which is when it should be straightest.
//   * A crouch shortens the legs, which lowers the body *and* bends the knees in
//     one move. That is the whole tiptoe posture, out of one number.

const TAU = Math.PI * 2;

// Where a leg is in its own cycle: 0 the instant the heel lands, 1 the next
// time it lands. The two legs are half a cycle apart.
export function legCycle(walkPhase, offset = 0) {
  const u = (walkPhase / TAU + offset) % 1;
  return u < 0 ? u + 1 : u;
}

// How far the foot has to travel, backwards through the body's frame, over one
// stance. The body covers `step` of ground per step and `2 * step` per cycle, of
// which the foot is down for `duty` — so this is that share of it, halved to get
// the reach either side of the hip. Derived, never chosen: getting this wrong by
// any amount at all is exactly how much the foot slides.
export function footReach(step, duty) {
  return step * duty;
}

/**
 * One foot, at cycle position u.
 *
 *   along    offset along the direction of travel, in world units, from the
 *            point the hip would be over if the character were standing still
 *   lift     height above the floor
 *   planted  1 while the foot is bearing weight, 0 while it is in the air
 */
export function footStep(u, g) {
  const reach = footReach(g.step, g.duty);
  if (u < g.duty) {
    const p = u / g.duty;
    // The heel comes off before the toe does. For the last part of the stance
    // the weight is on the ball of the foot and the ankle rides up, which is
    // the push-off — and which the shoe was already drawing while the ankle
    // ignored it. Without this the trailing leg goes on reaching backwards
    // flat-footed and drags the hips down into a second, smaller dip: a limp.
    const heel = p > 0.58 ? ((p - 0.58) / 0.42) ** 2 * g.lift * 0.40 : 0;
    // Planted. One straight line, and its slope is the body's speed with the
    // sign flipped. This is the line that stops the sliding — and note the heel
    // rising does not touch it, because a heel lifts without going anywhere.
    return { u, along: reach - p * reach * 2, lift: heel, planted: 1 };
  }
  // The swing: the same ground, covered in less time, so it is quicker than the
  // stance and has to look it. Eased at both ends — a foot leaves the floor and
  // arrives at it slowly, and only the middle of the swing is fast.
  const t = (u - g.duty) / (1 - g.duty);
  const e = t * t * (3 - 2 * t);
  return {
    u,
    along: -reach + e * reach * 2,
    // Zero at both ends by construction, so the foot touches down exactly as it
    // is planted. A foot that lands at a height is a floating foot.
    lift: Math.sin(t * Math.PI) ** 0.8 * g.lift,
    planted: 0
  };
}

// A little knee flexion in the middle of the stance, where the leg takes the
// weight. Nothing at contact or at toe-off, which are the moments the leg is
// straight. Small: this is a person walking, not doing squats.
function absorb(u, g) {
  if (u >= g.duty) return 0;
  return Math.sin((u / g.duty) * Math.PI) * g.absorb;
}

/**
 * How far the hips sit above the floor.
 *
 * Not a curve anybody drew. With a foot planted and a leg of a known length
 * there is exactly one height the hip can be, and this finds it — taking the
 * lower answer when both feet are down, because a leg cannot stretch. Running
 * has a moment with neither foot down, and that is the only part of this that
 * is an arc rather than a constraint.
 */
export function pelvisRise(u, g) {
  const legs = [u, (u + 0.5) % 1];
  let rise = -Infinity;
  let supported = false;
  for (const cu of legs) {
    if (cu >= g.duty) continue;
    supported = true;
    const foot = footStep(cu, g);
    const len = g.legLen - absorb(cu, g);
    const span = Math.sqrt(Math.max(0, len * len - foot.along * foot.along));
    // Height above the floor, not above the ankle: a leg pushing off stands on
    // its toes, and the hip it is holding up rides that high too.
    const held = foot.lift + span;
    // The lowest hip any planted leg will allow.
    rise = rise === -Infinity ? held : Math.min(rise, held);
  }
  if (supported) return rise;
  // Airborne. Both feet are off the floor, so the body is a projectile: it
  // leaves the ground at toe-off, arcs, and lands. Only a run gets here.
  const gap = 0.5 - g.duty;
  const t = (u < 0.5 ? u - g.duty : u - 0.5 - g.duty) / gap;
  return g.legLen + Math.sin(t * Math.PI) * g.flight;
}

/**
 * The knee, by two-bone inverse kinematics.
 *
 * Given a hip and an ankle, the knee is the third corner of a triangle with two
 * known sides. That is one square root, and it is worth it: the knee is then
 * correct at every point of the cycle by construction instead of by a curve
 * somebody fitted by eye, and it stays correct when the character crouches,
 * lengthens its stride or is drawn a tenth larger.
 *
 * `ux, uy` is the direction the knee bends towards — forwards, for a person.
 */
export function kneeOf(hipX, hipY, ankleX, ankleY, seg, ux, uy) {
  const dx = ankleX - hipX;
  const dy = ankleY - hipY;
  const span = Math.hypot(dx, dy) || 0.0001;
  const half = Math.min(span, seg * 2) / 2;
  // How far the knee stands off the hip-to-ankle line.
  const out = Math.sqrt(Math.max(0, seg * seg - half * half));
  const midX = hipX + (dx / span) * half;
  const midY = hipY + (dy / span) * half;
  // Normalised here rather than at the call sites, which mix headings with
  // foreshortened offsets and cannot easily hand over a unit vector. Skipping
  // it makes the knee stand off by a distance that quietly varies with the
  // direction the character happens to be walking.
  const mag = Math.hypot(ux, uy) || 1;
  return { x: midX + (ux / mag) * out, y: midY + (uy / mag) * out };
}
