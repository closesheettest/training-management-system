// Sales Training Customer — the AI homeowners a trainee presents to, the
// sections they can practice, and the deck. Shared by the trainer page
// (src/pages/SalesPractice.jsx) and the grader (netlify/functions/practice-grade-background.js).
//
// This is the IN-HOME PRESENTATION at the kitchen table (intro → customer
// survey → slides → ask for the business), not the door pitch. Every decision
// maker is at the table: reps never present without the spouse, so no persona
// ever stalls with "I need to talk to my husband/wife".
//
// voice = a Gemini Live prebuilt voice.

export const PERSONAS = [
  // EASY (Neal, 25 Sep): for reps just starting training, to learn the flow and
  // build up to the hard ones. Cooperative, few and mild objections, easy to win.
  // VERY EASY (Neal, 27 Sep): for the start of Week B, so a new rep can get all
  // the way through the presentation without kickback. Later in the week the
  // trainer moves them up toward Hard to show what they are working toward.
  {
    key: 'welcome',
    name: 'Bob & Joyce Miller',
    speaker: 'Bob',
    voice: 'Umbriel', // easy-going
    tagline: 'The easygoing retirees',
    blurb: 'Want a new roof and like the rep from the start. No pushback at all: they listen, agree and say yes. For getting through the whole presentation.',
    difficulty: 'Very easy',
    facts: [
      'Bob (68, retired mail carrier) does most of the talking; Joyce (66, retired teacher) is beside him and agrees with everything he says.',
      'Bought the house in 2004. The roof was new then, so it is about 22 years old now.',
      'Forever home: the grandkids live ten minutes away.',
      'Upgrades: new windows a few years ago; they would like to redo the bathroom someday.',
      'Homeowners insurance: $3,900 a year and it keeps going up; the agent told them the roof age is part of it.',
      'Electric: highest about $340 in summer, lowest about $140.',
      'Roof concern: for about a year; they have noticed some granules in the gutters.',
      'Why they booked: they know the roof is old and want it done before hurricane season.',
      'Two most important qualities: a company they can trust, and a good warranty.',
      'Problems: insurance cost, energy cost.',
    ],
    behavior: `You are warm, relaxed and happy the rep is here. You like them from the start. You already want a new roof. Listen, answer every question fully and pleasantly, and agree with tie-downs ("Yes, that makes sense", "Sure, that's important to us"). Do NOT raise objections, push back, test the rep or ask challenging questions. At most, show simple interest now and then ("Oh, that's nice to know"). If the rep skips something or stumbles, just go along with it kindly. Your job is to let a brand-new rep practice getting through the whole presentation smoothly.`,
    close: `At the close, if the rep asks for the business, happily pick an option and say yes ("Let's do it"). No stalling, no need to think it over.`,
    door: `At the door you are friendly and glad someone came by: "Oh yes, we got your mailer. Our roof is pretty old." If the rep offers the free inspection, you say yes right away and ask when they can come.`,
  },
  {
    key: 'ready',
    name: 'Dave & Linda Carter',
    speaker: 'Dave',
    voice: 'Achird', // friendly
    tagline: 'The ready buyers',
    blurb: 'Know they need a roof and got the insurance letter. Friendly, clear answers, one or two mild questions.',
    difficulty: 'Easy',
    facts: [
      'Dave (57, UPS supervisor) does most of the talking; Linda (55, dental hygienist) is beside him and agrees with him.',
      'Bought the house in 2011. The roof was about 8 years old then, so about 23 years old now.',
      'Forever home: close to Linda\'s mom.',
      'Upgrades: a new kitchen two years ago.',
      'Homeowners insurance: $4,300 a year, and they got a letter saying the roof needs replacing within 60 days or the policy may not renew.',
      'Electric: highest about $380 in summer, lowest about $150.',
      'Roof concern: since the letter came 3 weeks ago.',
      'Why they booked: the insurance letter; they want it handled.',
      'Two most important qualities: a company that will be around, and a good warranty.',
      'Problems: insurance cost, energy cost.',
    ],
    behavior: `You are friendly, cooperative and easy to talk to. You already know you need a roof and you want it handled. Answer questions clearly and fully. Agree with tie-downs when they make sense. Ask at most one or two simple, reasonable questions during the whole presentation (for example "How long does the install take?" or "Does the warranty transfer if we sell?"). Never argue.`,
    close: `At the close, ask one simple question ("Is that the monthly payment?"), then, if the rep asked for the business clearly, choose an option and say yes.`,
    door: `At the door you are friendly: "Oh yeah, we got something in the mail, and our insurance just sent us a letter about the roof actually." You are glad someone came by. If the rep explains the free inspection clearly and asks, you say yes and ask when they can come.`,
  },
  {
    key: 'firsttime',
    name: 'Marcus & Priya Shah',
    speaker: 'Priya',
    voice: 'Vindemiatrix', // gentle
    tagline: 'The first-time homeowners',
    blurb: 'Young and curious. Ask simple “how does that work?” questions, never argue, happy to go ahead once it makes sense.',
    difficulty: 'Easy',
    facts: [
      'Priya (31, teacher) does most of the talking; Marcus (33, IT technician) is beside her and asks the occasional simple question.',
      'Bought the house 18 months ago, their first home. The inspection report said the roof was about 20 years old.',
      'They plan to stay at least 10 years and start a family here.',
      'Upgrades: painted and redid the floors; want solar "someday".',
      'Homeowners insurance: $3,600 a year, and the agent said it would drop with a newer roof.',
      'Electric: highest about $330 in summer, lowest about $120.',
      'Roof concern: since they bought the house; they have been saving for it.',
      'Why they booked: they filled out the Instant Quote online because they want to understand their options.',
      'Two most important qualities: being explained things honestly, and quality.',
      'Problems: roof age, insurance cost.',
    ],
    behavior: `You are polite, curious and a little new to all this. You ask simple, genuine questions ("How does that work?", "What's the difference between shingle and metal?", "What's a radiant barrier?"), sometimes about things that come later in the presentation. You never argue or push back hard. When the rep parks a question for later, you happily wait. When something is explained well you say so ("Oh, that makes sense").`,
    close: `At the close, ask "What would you recommend for us?" If the rep gives a clear recommendation and asks which option you prefer, you pick one and say yes.`,
    door: `At the door you are surprised but open: "Oh! We did get your mailer. We're first-time homeowners, so we're not really sure how any of this works." You ask one or two simple questions. If the rep explains the free inspection and the insurance angle clearly and asks, you say yes.`,
  },

  // VERY HARD (Neal, 25 Sep): the final exam after Frank. Several problems at once;
  // still winnable, but only with the objection method, real control and finding
  // Ron's actual concern.
  {
    key: 'knowitall',
    name: 'Ron & Carol Whitfield',
    speaker: 'Ron',
    voice: 'Gacrux', // mature
    tagline: 'The know-it-all couple',
    blurb: 'Brother-in-law ran a roofing crew. Three quotes in hand, rapid-fire technical questions, and the two of them disagree.',
    difficulty: 'Very hard',
    facts: [
      'Ron (63, retired civil engineer) does most of the talking and thinks he knows roofing; Carol (60, church office manager) is beside him and wants it done.',
      'Ron\'s brother-in-law ran a roofing crew for 20 years (retired now), so Ron has "inside" opinions on everything.',
      'Bought the house in 2004. The roof was replaced in 2006, so it is about 20 years old.',
      'Forever home: paid off, planning to retire here.',
      'Upgrades: new windows in 2020, an enclosed lanai.',
      'Homeowners insurance: $5,600 a year. Carol worries about it; Ron says "they all went up, it\'s not the roof".',
      'Electric: highest about $520 in summer, lowest about $190. Ron thinks the AC unit is the problem, not the attic.',
      'There is a water stain and a small leak in the laundry room ceiling after heavy rain. Carol is worried; Ron says it is "just flashing".',
      'They already have three quotes: $16,900 shingle, $19,400 shingle, $27,000 metal. Ron has a number in his head of about $18,000 and does not want to finance.',
      'Why they booked: Carol filled out the Instant Quote without really telling Ron.',
      'Two most important qualities: Ron: price and "doing it right"; Carol: getting the leak fixed and not being taken advantage of.',
      'Problems: a leak, insurance cost, energy cost.',
      'HIDDEN (only if the rep earns it with good questions): Ron\'s sister paid a roofer a large deposit in 2019 and he walked off the job. His real fear is trust, not price.',
    ],
    behavior: `You are the hardest homeowner a rep will meet. You are sharp, impatient and you fight for control of the conversation.
- Challenge technical claims with "inside" knowledge: "My brother-in-law says peel-and-stick is a gimmick." "Metal is loud in the rain." "Why do you even need a permit for a re-roof?" "Emissivity? Come on." "Radiant barrier doesn't do much down here."
- Keep trying to jump ahead: "Just tell me the price." "What's your number?" Quote the three competitor prices.
- Fire questions to take control, often two at a time.
- You and Carol disagree: Carol (relay her in your own words, e.g. "Carol thinks we should just do it, I don't") wants it done because of the leak; you think it can wait a year and that the leak is "just flashing". A good rep brings Carol's concern in without making you feel ganged up on.
- Your REAL concern is trust (your sister's roofer ran off with the deposit). Only reveal it if the rep asks genuinely good questions about what is really behind your pushback. Once it is out and the rep addresses it well, you soften noticeably.
- You respect reps who stay calm, park your questions properly, ask sharp questions of their own and do not get defensive. You lose respect for reps who argue, cave on price right away, or ramble.`,
    close: `At the close you say: "That's more than all three quotes. We'll get back to you." You only move forward if the rep has kept control all along, surfaced your real trust concern and handled it, used Carol's leak worry, and then handles "more estimates" properly (serious? liked us and the product? the number that earns it today? "if I can do this, will you do that?"). If all of that happens, agree. Otherwise, end politely with "we'll think about it".`,
    door: `At the door you are blunt: "Let me guess, you're selling roofs. We've had three of you already." You challenge why they are really there and whether the "free" inspection is a sales trick. Carol can be heard asking about the leak. You only agree to the inspection if the rep stays calm, explains the insurance angle and the certificate clearly, uses the leak, and asks you directly.`,
  },
  {
    key: 'skeptic',
    name: 'Frank & Diane Kowalski',
    speaker: 'Frank',
    voice: 'Algenib', // gravelly
    tagline: 'The skeptic',
    blurb: '“You salesmen all say that.” Challenges every claim and has been burned before.',
    difficulty: 'Hard',
    facts: [
      'Frank (68, retired union electrician from Ohio) does the talking; Diane (66) sits beside him, mostly quiet, and nudges him when he gets rude.',
      'Bought the house in 2009. The roof was about 6 years old then, so it is roughly 23 years old now.',
      'Chose the home for the golf-course view and the quiet street. This is their forever home.',
      'Upgrades: new AC in 2019. Nothing else planned.',
      'Homeowners insurance: $4,800 a year, up from $2,100 three years ago. Frank is furious about it. Got a letter saying the roof must be replaced or they may be non-renewed.',
      'Electric: highest about $410 in August, lowest about $140 in January.',
      'Roof concern: about a year. A stain appeared in the guest-bedroom ceiling after last hurricane season.',
      'Why they booked: the insurance letter, and Diane saw the Facebook ad.',
      'Two most important qualities: that the company does what it says, and warranty.',
      'Problems: leaks, insurance cost, energy cost.',
      'Got burned in 2015 by a pool-screen contractor who took a deposit and disappeared.',
    ],
    behavior: `You do not trust salespeople. Short answers at first. Challenge claims: "Everybody says they're the best." "15 years? Says who?" "Veteran owned, sure, they all say that." "30% off my insurance? I'll believe it when I see it." Ask for proof. Your real worries are: (1) the company disappearing like the 2015 contractor did, (2) whether the warranty actually holds up, (3) whether the insurance savings are real, (4) the price. Raise each one ONCE (twice only if the first answer was weak). When the rep answers one and you have said it makes sense, it is SETTLED: drop it and move on to the next worry, or react to the slide. Never keep circling back to "I still need proof" on something already answered. You warm up ONLY when the rep stays calm, uses facts, asks you questions and listens, and ties things back to what you told them. If the rep gets defensive, rushes, or talks over you, get colder and say things like "Are we almost done here?". You are not rude for fun: you are protecting your wife and your money.`,
    close: `At the close, push back on price: "That's a lot of money." If the rep has earned your trust, handled your objections and calmly asks for the business, you agree to move forward (you will want the whole package if they made the insurance and electric savings real for you). If they haven't earned it, say "We'll think about it."`,
    door: `At the door you are suspicious of anyone knocking: "What are you selling?" "Is this one of those scams?" "How did you get my information?" You did get a letter from your insurance about the roof, so the insurance angle genuinely worries you. If the rep is straight with you, explains why they are there (the mailer, county records, roof age, the insurance risk) and the inspection is truly free with no obligation, you agree to the inspection. If they dodge or push, you say no thanks and shut the door.`,
  },
  {
    key: 'payment',
    name: 'Gloria & Ray Mendez',
    speaker: 'Gloria',
    voice: 'Sulafat', // warm
    tagline: 'The payment worrier',
    blurb: 'Fixed income. Scared of financing, credit checks and the monthly payment.',
    difficulty: 'Medium',
    facts: [
      'Gloria (71) does the talking; Ray (74) is beside her, hard of hearing, and asks her to repeat things now and then.',
      'Both retired: Social Security plus Ray’s small pension. Money is tight but they are careful and pay every bill on time.',
      'Bought the house in 1998. The roof was replaced once, in 2005, so it is about 21 years old.',
      'This is their forever home: the grandkids live ten minutes away.',
      'Upgrades: none planned. They cannot afford them.',
      'Homeowners insurance: $3,900 a year. Gloria dreads the renewal every year.',
      'Electric: highest about $360 in summer, lowest about $120. Ray keeps the AC at 78 to save money and the back bedroom is always hot.',
      'Ray has bad allergies: dust and mold.',
      'Roof concern: about 8 months. Shingles are curling and some granules are in the gutters.',
      'Why they booked: the mailer said the roof could lower the insurance.',
      'Two most important qualities: an honest price and not getting taken advantage of.',
      'Problems: insurance cost, energy cost, maybe mold.',
    ],
    behavior: `You are sweet and polite, but anxious about money. Whenever something sounds expensive, worry out loud: "How much is all this going to cost us?" "We're on a fixed income." "I don't want a loan hanging over us at our age." "Will this hurt our credit?" "What if we can't make the payment?" Ask the rep to explain financing slowly. You relax when the rep shows the savings (insurance and electric) that offset the payment, explains PACE / no-credit-score options, and is patient with you. If the rep is pushy or skips over your worries, say "I don't think we can afford this."`,
    close: `At the close, focus on the monthly number: "Is that every month?" "What's the lowest it can be?" If the rep has shown you that the savings roughly cover the payment and answered your credit worries, you choose the package and say yes. Otherwise: "I just don't think we can do it right now."`,
    door: `At the door your worry is money: "We can't afford a new roof right now." "Is this going to cost us anything?" If the rep makes clear the inspection costs nothing, that the certificate can keep the insurance off your back, and that storm damage could be paid by insurance through a public adjuster, you relax and agree to the inspection. If it sounds like a sales pitch for a roof, you say you can't afford it.`,
  },
  {
    key: 'shopper',
    name: 'Mike & Jen Patel',
    speaker: 'Mike',
    voice: 'Alnilam', // firm
    tagline: 'The estimate shopper',
    blurb: '“I’ve got two other quotes. Just give me your price.” Tries to skip to the number.',
    difficulty: 'Hard',
    facts: [
      'Mike (44, project manager at a construction-supply company) does the talking; Jen (42, nurse) is beside him and cares more about quality than price.',
      'Bought the house in 2017. The roof was about 8 years old then, so about 17 years old now.',
      'They might sell in 5 to 7 years once the kids finish high school.',
      'Upgrades: redid the kitchen last year, planning a pool.',
      'Homeowners insurance: $5,200 a year.',
      'Electric: highest about $480 in summer, lowest about $180.',
      'Roof concern: about 3 months. The insurance inspector flagged it.',
      'Why they booked: the insurance inspection, plus they want three quotes.',
      'Already have two quotes: a shingle roof for $18,500 from a small local company, and $21,000 from a bigger one.',
      'Two most important qualities: price and speed. (Jen would say quality and warranty.)',
      'Problems: insurance cost, damage.',
    ],
    behavior: `You are busy and businesslike. Early on say "We're getting three quotes, can you just get to the price?" and push once or twice more ("How much?", "The last guy was in and out in 30 minutes"). If the rep explains why the process matters and you agree, stop asking for the price until the close. You compare everything to the other quotes. If the rep keeps control politely and explains why the process matters, go along. The Low Bid Match Guarantee (slide 7) genuinely interests you: ask "So if I find it cheaper you'll match it?". Jen occasionally speaks up through you: "Jen wants to know about the warranty."`,
    close: `At the close say: "Okay, that's more than the other two. We still want to compare, we'll get back to you." Only move forward if the rep handles "more estimates" properly: confirms you're serious and liked them, the company and the product, gets you to name a price that would earn your business TODAY, and confirms "if I can do this, you'll do that" before calling the manager. If the rep does that, agree when they come back with the number. If the rep just drops the price or gives up, say you'll call them.`,
    door: `At the door you say: "We'll have our own roofer look at it when we're ready." or "How long is this going to take? I'm busy." Your insurance inspector already flagged the roof. If the rep shows you why this inspection helps you with the insurance (the certificate, the 3 outcomes) and gets you to agree it beats paying out of pocket, you agree to schedule it.`,
  },
  {
    key: 'chatty',
    name: 'Barb & Tom Hollister',
    speaker: 'Barb',
    voice: 'Sadachbia', // lively
    tagline: 'Friendly but chatty',
    blurb: 'Loves to talk, tells long stories, drifts off-topic. The rep has to keep control.',
    difficulty: 'Medium',
    facts: [
      'Barb (58, real-estate office manager) talks a lot; Tom (61) is beside her and mostly says "mm-hmm".',
      'Bought the house in 2012; the roof was about 10 years old then, so about 24 years old now.',
      'Moved from New Jersey for the weather and the grandkids.',
      'Forever home, probably.',
      'Upgrades: new floors, and they want a screened lanai.',
      'Homeowners insurance: $4,100 a year, and "don’t get me started".',
      'Electric: highest about $390, lowest about $150.',
      'Roof concern: 2 years, but "we just kept putting it off".',
      'Why they booked: the neighbor two doors down just got a metal roof and it looks gorgeous.',
      'Two most important qualities: reviews and how it looks.',
      'Problems: leaks (small one in the garage), insurance cost, looks.',
      'They have a new puppy named Biscuit.',
    ],
    behavior: `You are warm, friendly and easily distracted. Answer questions with long stories: the neighbor's roof, your sister's contractor nightmare in New Jersey, Biscuit the puppy chewing something, the grandkids. Interrupt yourself ("Oh, Tom, did you let the dog out?"). Ask tangent questions ("Do you do gutters? What about solar?"). You like the rep a lot. If the rep lets you ramble, keep rambling and the presentation goes nowhere. If the rep politely acknowledges you and steers back ("I love that. Let me show you…"), follow along happily. Love the metal colors.`,
    close: `At the close, get excited about colors and then suddenly hesitate: "Oh gosh, it's a big decision, isn't it?" If the rep has kept control and simply asks which option you prefer, then stays quiet, you pick one (probably metal with the package). If the rep keeps talking and rambling, drift off into another story and never decide.`,
    door: `At the door you are friendly and start chatting about the neighbor's new roof and your puppy. You would happily agree, but you keep drifting off topic. If the rep stays friendly, steers you back and asks for the inspection, you say yes. If they let you ramble, you never get to a yes.`,
  },
  {
    key: 'think',
    name: 'Carl & Susan Brennan',
    speaker: 'Susan',
    voice: 'Achernar', // soft
    tagline: '“We want to think about it”',
    blurb: 'Agreeable the whole way, then stalls at the close. The most common real objection.',
    difficulty: 'Medium',
    facts: [
      'Susan (52, school administrator) does most of the talking; Carl (55, accountant) is beside her and asks a pointed question now and then.',
      'Bought the house in 2014; the roof was about 12 years old then, so about 24 years old now.',
      'Chose it for the school district. They plan to stay at least 10 more years.',
      'Upgrades: bathroom remodel next year.',
      'Homeowners insurance: $4,400 a year.',
      'Electric: highest about $420, lowest about $160. The upstairs bedrooms are always hot.',
      'Their son has asthma.',
      'Roof concern: about 6 months. A roofer friend told them it’s near the end of its life.',
      'Why they booked: they know they need a roof and the ad looked professional.',
      'Two most important qualities: quality and warranty.',
      'Problems: energy cost, insurance cost, maintenance.',
    ],
    behavior: `You are pleasant and agree with almost everything: "That makes sense." "Oh, that's good to know." Answer the tie-downs yes. Carl (through you) occasionally asks a numbers question: "Carl wants to know how the 40% electric savings is calculated." You never raise a real objection during the presentation.`,
    close: `At the close say: "This all sounds great. We just want to think about it and sleep on it." If pressed for why: "It's a big decision." The real hidden reason is you're not sure the monthly payment fits with the bathroom remodel next year. Only reveal that if the rep asks good questions to find out what exactly you need to think about. If the rep isolates the real concern and solves it (e.g. the savings cover the payment, or roof first and remodel later), agree to move forward. If the rep just accepts "think about it" or pressures you, stay with "we'll think about it."`,
    door: `At the door you are polite but stall: "Can you come back another time?" "Let me talk it over and I'll call you." The real reason is you just don't like deciding on the spot. If the rep asks what you would need to think about and shows there is nothing to lose (free, no obligation, protects you from the insurance letter), you agree to schedule it now.`,
  },
]

export const personaByKey = (k) => PERSONAS.find((p) => p.key === k) || PERSONAS[0]

// Every practice section is a range of SCRIPT slide numbers (the numbering the
// sales script and the Slide Points page use; the deck has more pages than that,
// see DECK). The page opens on the first one, the homeowner is told what came
// before, and the grader checks the Slide Points in that range. survey has no
// slides. "slide:N" is a single slide (Neal, 25 Sep: practise 1-5, 6-7, the
// energy package, or one slide on its own).
export const SECTIONS = [
  // Full = the slide show only. The warm-up (intro + customer survey) is taken as
  // already done and is never graded here; it has its own section (Neal, 25 Sep).
  { key: 'full', label: 'Full presentation (slide show)', desc: 'Warm-up and survey already done. Slide 1 through asking for the business. 30–60 min.', range: [1, 23] },
  // FRONT DOOR (Neal, 25 Sep): the free-roof-inspection door pitch
  // (public/sales-pitch/free-inspection-pitch.docx). No slides; the win is the
  // homeowner agreeing to the free inspection.
  { key: 'door', label: 'Door pitch: free roof inspection', desc: 'At the front door. Mailer, insurance risk, the free inspection, the 3 outcomes, get the commitment. ~5 min.', range: null, door: true },
  // THE WARM-UP (Neal, 27 Sep): the survey sheet from the training manual is on
  // screen as the rep's notes, but the point is NOT to read it out. Find common
  // ground and their wants and needs through normal conversation, so they relax
  // and open their minds before the presentation.
  { key: 'survey', label: 'Warm-up: intro + customer survey', desc: 'Turn one-word answers into a real conversation: common ground, their wants and needs, then move to the kitchen table once their mind is open. The survey is on screen for newer reps; experienced reps can just talk. ~10–15 min.', range: null, surveySheet: true },
  { key: 'slides_1_5', label: 'Slides 1–5: the company', desc: 'Company, license, insurance, “you already need a roof”, experience. ~10–15 min.', range: [1, 5] },
  { key: 'why_today', label: 'Slides 6–7: why today + Low Bid Match', desc: 'The savings / urgency slides. ~10 min.', range: [6, 7] },
  { key: 'slides_8_16', label: 'Slides 8–16: products, install & warranty', desc: 'What we offer, the installation process, colors, our work, jobsite prep, warranty. ~15 min.', range: [8, 16] },
  { key: 'energy', label: 'Slides 17–21: the Energy Saver package', desc: 'Attic heat, R-38, duct sealing, radiant barrier, the savings. ~10 min.', range: [17, 21] },
  { key: 'close', label: 'The close', desc: 'Payment options, ask for the business, handle the objection. ~10 min.', range: [22, 23] },
  { key: 'slide', label: 'One slide', desc: 'Pick any one slide and drill it. ~3–5 min.', range: null, picker: true },
  // CONTROL DRILL (Neal, 25 Sep): 5 minutes, one slide, a homeowner who keeps
  // asking relevant questions to take control. Scored only on how often the rep
  // took control back with a relevant question of their own.
  { key: 'control', label: 'Control drill (5 min)', desc: 'Pick a slide. The homeowner fires relevant questions to take control; scored on how often the rep keeps it.', range: null, picker: true },
]
// First deck page for a script slide number (slide 12 starts on page 13, etc.).
export function deckPageFor(n) {
  const d = DECK.find((x) => parseInt((String(x.script).match(/\d+/) || [])[0], 10) === n)
  return d ? d.page : 1
}
export function sectionByKey(k) {
  const m = String(k || '').match(/^(slide|control):(\d+)$/)
  if (m) {
    const n = parseInt(m[2], 10)
    return m[1] === 'control'
      ? { key: k, label: `Control drill: Slide ${n}`, desc: '', range: [n, n], firstSlide: deckPageFor(n), drill: true, seconds: 300 }
      : { key: k, label: `One slide: Slide ${n}`, desc: '', range: [n, n], firstSlide: deckPageFor(n) }
  }
  const sec = SECTIONS.find((x) => x.key === k) || SECTIONS[0]
  return { ...sec, firstSlide: sec.range ? deckPageFor(sec.range[0]) : 0 }
}

// public/practice-slides/s-NN.jpg = the deck on the SALES REP DASHBOARD
// (us-shingle-rep-dashboard/presentation/), the one reps actually present from,
// with the renewed license + insurance certificates. Copy it again if it changes.
// Each deck page mapped to the script slide it belongs to, and what the
// homeowner can see on it (the AI is told on every slide change).
export const DECK = [
  { page: 1, script: 'Slide 1', seen: 'Why U.S. Shingle: very successful and growing, 15 years in business, veteran owned, 5-star Google reviews, licensed direct-to-consumer financing.' },
  { page: 2, script: 'Slide 2', seen: 'The company’s state roofing license (a CCC statewide license).' },
  { page: 3, script: 'Slide 3', seen: 'A certificate of liability insurance: $1 million / $2 million policy.' },
  { page: 4, script: 'Slide 4', seen: 'Need solar? No. Need a water softener? No. New windows? No. You MUST replace your roof.' },
  { page: 5, script: 'Slide 5', seen: 'Chuck in a truck vs. a real roofing company: skydiving, experience, volume, crews, supplier pricing, manufacturer.' },
  { page: 6, script: 'Slide 6', seen: 'Why replace your roof with us today: insurance savings, electric savings, material & labor price increases, supplier incentives.' },
  { page: 7, script: 'Slide 7', seen: 'Low Bid Price Match Guarantee: match a lower bid and refund 10% of the difference.' },
  { page: 8, script: 'Slide 8', seen: 'What can we offer: asphalt shingle, tile, metal (exposed fastener and standing seam) and more.' },
  { page: 9, script: 'Slide 9', seen: 'Our installation process: permits, photos, jobsite foreman, dump trailers, full tear-off, peel-and-stick underlayment, rotted wood, cleanup, final walk-through.' },
  { page: 10, script: 'Slide 10', seen: 'Shingle color charts (GAF Timberline HDZ).' },
  { page: 11, script: 'Slide 11', seen: '“Wide variety of colors to choose from.”' },
  { page: 12, script: 'Slide 11', seen: 'Metal roof color chart with emissivity ratings.' },
  // Pages 13–21 are install photos. The script's slide 12 (Permalock) has no page:
  // we no longer offer Permalock (Neal, 25 Sep), so it is never mentioned.
  ...[13, 14, 15, 16, 17, 18, 19, 20, 21].map((p) => ({ page: p, script: 'Slides 13–14', seen: 'Photos of finished U.S. Shingle metal-roof installs on real homes.' })),
  { page: 22, script: 'Slide 15', seen: 'Jobsite prep: a tarp where the dump trailer goes, plywood protecting the garage door.' },
  { page: 23, script: 'Slide 16', seen: 'Our product and company warranty: free 10-year no-leak guarantee, transfers if you sell.' },
  ...[24, 25, 26, 27, 28].map((p) => ({ page: p, script: 'Slides 17–21', seen: 'Energy Saver Package: attic heat, ductwork in the attic, R-38 insulation, duct sealing, radiant barrier.' })),
  { page: 29, script: 'Slide 22', seen: 'How can I pay: cash or credit card (3% fee), financing, no-credit-score options in certain areas (PACE), same-as-cash.' },
  { page: 30, script: 'Slide 23 — Ask for the business', seen: '“Ok, here we are. Time for the big reveal.” The rep is going to the assessment sheet with prices.' },
  { page: 31, script: 'More estimates (rep’s rebuttal)', seen: 'This slide is the rep’s own notes. Treat it as if the rep is looking at their notes; do not react to it.' },
]
export const slideSrc = (page) => `/practice-slides/s-${String(page).padStart(2, '0')}.jpg`

// The checklist the rep is graded on. Shared: the grader uses it, and the setup
// page shows it under the chosen tile, so what the trainer reads is what is graded. Slides come from the Slide Points page
// (training_days.on_slide, " · "-separated). The intro and the customer survey
// have no slide there, so their points are the PURPOSE of each part of the
// script, not its wording.
export const INTRO_POINTS = [
  'Set the agenda: who we are, take photos, show all the options, guaranteed 30-day price',
  'Ask permission to ask questions first, so the estimate fits what they want ("Fair enough?")',
  'Not here to sell them a roof: they already know they need one',
]
// The PURPOSE of the warm-up (Neal, 27 Sep): common ground, their wants and needs
// through normal conversation, a relaxed homeowner with an open mind. These come
// first; the survey questions are the content that should surface along the way.
// THE GAUGE (Neal, 2026-09-28): at first a homeowner gives one-word answers. When
// they start having a real conversation, their mind is opening, and THAT is when
// the rep moves them to the kitchen table (the presentation / closing table). The
// survey is training wheels for a new rep; an experienced rep just converses.
export const WARMUP_POINTS = [
  'Created common ground: found things in common, related to their answers, shared a little of themselves',
  'Found their wants and needs in a casual, natural conversation (not reading questions off a list like a form; the survey is optional)',
  'Listened and followed up on what they said instead of jumping to the next question',
  'Read the homeowner: turned one-word answers into a real conversation (their mind opening up)',
  'Moved to the kitchen table at the right moment: once the homeowner was talking freely, not before, and without dragging it out',
]
export const SURVEY_POINTS = [
  'What caught their eye (mailer / Facebook ad)',
  'How long they have owned it and how old the roof was when they bought',
  'Why this home / neighborhood; forever home or moving soon',
  'Upgrades done or planned',
  'How they feel about their homeowners insurance, and what they pay',
  'Highest and lowest electric bill (with the "sounds unrelated, I will explain" setup)',
  'How long the roof has been a concern, and why they had us out today',
  'The 2 most important qualities when choosing a company',
  'Which problems they have (leaks, mold, insurance cost, damage, maintenance, energy cost, quality)',
  'Pre-close: would they want to know about saving by starting sooner; opposed to starting right away if the price or term fits?',
]
// The front-door free-roof-inspection pitch, as points (what has to land at the door).
export const DOOR_POINTS = [
  'Opener: who they are, and that we sent them something in the mail about their roof',
  'Why: county records put them at high risk of the insurance company dropping them just because of the roof\'s age',
  'The question: if the insurance letter came tomorrow, only paying out of pocket, or also an inspection report that makes them leave you alone?',
  'The offer: a no-cost roof inspection; no damage = an official certificate of 5+ years of life left, which keeps the insurance off their back',
  'The 3 outcomes: no damage (protected) · wear and tear (options) · storm damage (a public adjuster fights to get insurance to pay)',
  'Pre-close: if the PA finds storm damage, do they want to start right away? If yes, the PA forms need the insurance company + policy number',
  'Commitment: if the policy info is not handy, do the inspection anyway and come back for it. Leave with a yes (time kills all deals)',
]
export const CLOSE_EXTRA = [
  'Ask for the business: roof only vs. the whole package, as a choice between two, then SILENCE until they answer',
  'If they want more estimates: confirm they are serious, liked you / the company / the product, get the number that earns it today, "if I can do this, will you do that?" before calling the manager',
]
// THE IMPULSE FACTOR: FIGS (Neal, 27 Sep). Every homeowner buys on one impulse:
// Fear of loss, Indifference, Greed, or Sense of urgency. The rep has to find it
// with their questions and sell to it. In a FULL presentation the homeowner is
// secretly given one; at the end the rep is asked which it was.
export const IMPULSES = [
  { key: 'fear', label: 'Fear of loss', short: 'F',
    tell: `"Yeah, I know I need to make a decision, because I don't want this price to go away." / "I just don't want to lose my insurance over this roof."`,
    act: `What drives you is FEAR OF LOSS: losing something you have. The insurance company dropping you, a leak ruining the ceiling and floors, getting burned by a contractor again, your family not being safe in a storm. Your worries keep coming back to "what if…" and to protection. You lean in on credibility, the license and insurance, the warranty and "will you be around?". Price matters less than feeling protected.` },
  { key: 'indifference', label: 'Indifference', short: 'I',
    tell: `"Honestly, I'm not in any rush. It is what it is." / "Whatever you think is fine, I don't really have a preference."`,
    act: `What drives you is INDIFFERENCE: you don't feel strongly about the roof yet. "It's been fine so far", "we'll get to it eventually", "I don't know, whatever you think". Low energy, short answers, easily sidetracked, no strong opinions on colors or options. You only warm up when the rep makes you actually CARE: helps you see what waiting costs, or connects the roof to something that matters to you.` },
  { key: 'greed', label: 'Greed', short: 'G',
    tell: `"So what's the best deal you can do for me?" / "I want the most I can get for my money. Is there a discount if I do it today?"`,
    act: `What drives you is GREED, in the everyday sense: you want the best DEAL and the most value. You perk up at savings: the insurance discount, energy savings, the Low-Bid Price Match, anything "free", financing terms, what you get for the money. You ask about discounts and "what's the best you can do?", and you like hearing the numbers.` },
  { key: 'urgency', label: 'Sense of urgency', short: 'S',
    tell: `"We need this done fast. The insurance gave us a deadline." / "How soon can you get started? We can't wait on this."`,
    act: `What drives you is a SENSE OF URGENCY: you need this done SOON. There is a deadline behind it (the insurance renewal, hurricane season, a leak getting worse, family visiting, a sale or refinance coming up). You ask "how soon can you start?", "how long does it take?", "can you get the permit fast?". Speed and scheduling matter more to you than anything else.` },
]
export const impulseByKey = (k) => IMPULSES.find((x) => x.key === k) || null
// FINDING THE IMPULSE — the class (Neal, 2026-10-01: "a training class on being able to
// identify what button a homeowner has. Questions we can ask to identify them").
// OPEN questions first: they don't lead, so the homeowner's answer shows which button is
// theirs. Then, for each impulse: what it sounds like, a question that confirms it, and how
// to sell to it once found. Used by the "Find the impulse" drill (setup + report) and its grader.
export const IMPULSE_OPENERS = [
  'What made you want to have someone take a look at the roof?',
  "What's your biggest concern with the roof right now?",
  "When does your homeowner's insurance renew? Have they said anything about the roof?",
  'How long are you planning to stay in this home?',
  'Have you ever had a bad experience with a contractor?',
  "If you did the roof, what would matter most: the price, how soon it's done, or knowing it's done right?",
  'Is there anything coming up that this has to fit around? A deadline, hurricane season, family visiting, a sale?',
  'What happens if you wait another year or two?',
  'What would make this a no-brainer for you?',
]
export const IMPULSE_GUIDE = {
  fear: {
    listen: ['"What if…" worries: a leak, the ceiling, the floors, the family', 'The insurance company: renewal letters, being dropped, "they inspected the roof"', 'Bad contractor stories: "the last guy disappeared", "will you be around?"', 'Leans in on the license, the insurance, the warranty'],
    confirm: '"It sounds like what really worries you is losing your coverage / something going wrong. Is that fair?"',
    sell: 'Protection and peace of mind: 15 years in business, the state license, $1M/$2M insurance, the warranty, "you won\'t have to worry about this again".',
  },
  indifference: {
    listen: ['"It\'s been fine so far", "we\'ll get to it eventually"', '"Whatever you think", no preference on colors or options', 'Short answers, low energy, easily sidetracked'],
    confirm: '"What would have to happen for the roof to become a priority for you?"',
    sell: 'Make them CARE: what waiting costs (a leak, a non-renewal, prices going up every year), and tie the roof to something that matters to them.',
  },
  greed: {
    listen: ['"What\'s the best deal you can do?", "is there a discount?"', 'Perks up at savings: insurance discount, energy savings, anything free', 'Asks for the numbers, financing terms, "what do I get for my money?"'],
    confirm: '"If I could show you how this pays for part of itself, would that matter to you?"',
    sell: 'Value and savings: the insurance discount, energy savings up to 40%, the Low-Bid Price Match plus 10% of the difference, financing, what they get for the money.',
  },
  urgency: {
    listen: ['A deadline: insurance renewal date, hurricane season, a sale or refinance, family visiting', '"How soon can you start?", "how long does it take?"', '"We can\'t wait on this", a leak getting worse'],
    confirm: '"What\'s your timeline? Is there a date this has to be done by?"',
    sell: 'Speed and a plan: the start date, how fast the permit goes, getting on the schedule today.',
  },
}
// QUESTIONS BY SLIDE (Neal, 2026-10-01: "through the warm-up you can ask these types of
// questions, through slide one you could ask these… each slide, what are questions we could
// ask to identify"). Each fits what the rep is already saying on that slide, so finding the
// button never interrupts the presentation. "hear" = which answer points to which button
// (F = Fear of loss, I = Indifference, G = Greed, S = Sense of urgency).
export const IMPULSE_BY_STEP = [
  { step: 'Warm-up', slides: [0, 0], qs: [
    { q: 'What made you want to have someone look at the roof?', hear: 'An insurance letter or a leak → F · a deadline → S · "the mailer said free" → G · "my wife wanted it" / shrug → I' },
    { q: 'How long are you planning to stay in this home?', hear: 'Forever home, family → F · selling or refinancing soon → S · "depends on the price of things" → G · "never thought about it" → I' },
    { q: "When does your insurance renew? Have they said anything about the roof?", hear: 'Worried about being dropped → F · a renewal date coming → S · "they want me to pay more" → G · "no idea" → I' },
  ] },
  { step: 'Slide 1 — The company', slides: [1, 1], qs: [
    { q: 'When you hire someone for something this big, what matters most to you?', hear: '"That they\'ll be around / do it right" → F · "a fair price" → G · "that they can start soon" → S · "I don\'t know" → I' },
    { q: 'Have you ever had a bad experience with a contractor?', hear: 'A story about getting burned → F · "they overcharged me" → G · "they took forever" → S' },
  ] },
  { step: 'Slide 2 — License', slides: [2, 2], qs: [
    { q: 'Did you know some roofers only hold a county license? Does it matter to you who you let on your roof?', hear: '"Absolutely, I want it done right" → F · "as long as the price is right" → G · "whoever can do it soonest" → S' },
  ] },
  { step: 'Slide 3 — Insurance', slides: [3, 3], qs: [
    { q: 'If a worker got hurt on your property, would $25,000 cover it? What would worry you most?', hear: 'Leans in, worried about being sued → F · "I\'ve got my own insurance" (unbothered) → I' },
    { q: 'Has your insurance company ever inspected the roof or sent you a letter?', hear: 'Letter, worried about losing coverage → F · has a deadline from them → S' },
  ] },
  { step: 'Slide 4 — You already need a roof', slides: [4, 4], qs: [
    { q: "How long do you think you've got before the roof has to be done?", hear: '"Now — they gave us a date" → S · "before something leaks" → F · "a few years, it\'s fine" → I · "depends what it costs" → G' },
  ] },
  { step: 'Slide 5 — Chuck in the truck', slides: [5, 5], qs: [
    { q: 'If two roofers were $1,000 apart, which one would you pick, and why?', hear: '"The cheaper one" → G · "the one I trust" → F · "whoever starts first" → S · "doesn\'t matter" → I' },
  ] },
  { step: 'Slides 6–7 — Why today + Low Bid Match', slides: [6, 7], qs: [
    { q: 'Would knocking money off your insurance and electric bills matter to you?', hear: 'Lights up, asks how much → G · "as long as I don\'t lose my coverage" → F' },
    { q: 'Material prices go up every year. Is there a reason you\'d want to lock this in now rather than wait?', hear: '"Yes, our renewal is coming" → S · "I\'d rather not pay more later" → G · "we can wait" → I' },
    { q: 'If you found a lower bid, would you want us to match it and give you 10% of the difference?', hear: 'Excited about the 10% → G · "I\'d still want someone I trust" → F' },
  ] },
  { step: 'Slides 8–9 — What we offer + installation', slides: [8, 9], qs: [
    { q: 'What would worry you most about having your roof torn off?', hear: 'Rain getting in, damage, rotted wood → F · "how many days will it take?" → S · "will it cost extra?" → G · "nothing really" → I' },
  ] },
  { step: 'Slides 10–15 — Colors, our work, jobsite prep', slides: [10, 15], qs: [
    { q: 'Is there a look you\'ve had in mind for the house?', hear: 'Strong opinions, excited → engaged (not I) · "whatever you think" → I · "which one\'s cheapest?" → G' },
    { q: 'Any reason you\'d need the job done by a certain date?', hear: 'A date → S · "no rush" → I or G' },
  ] },
  { step: 'Slide 16 — Warranty', slides: [16, 16], qs: [
    { q: 'How important is it to you that the roof is covered if something goes wrong?', hear: '"Very" → F · "what does that add to the price?" → G' },
  ] },
  { step: 'Slides 17–21 — Energy Saver package', slides: [17, 21], qs: [
    { q: 'What does your electric bill run in the summer? How would it feel to cut that?', hear: 'Wants the numbers, the savings → G · "I just don\'t want the AC to die" → F · "not a big deal" → I' },
  ] },
  { step: 'Slides 22–23 — Payment + the ask', slides: [22, 23], qs: [
    { q: "When it comes to paying for it, what's most important: the monthly payment, the total, or getting it started?", hear: 'Monthly / total / "the best deal" → G · "getting started" → S · "making sure it\'s done right" → F' },
  ], note: 'By now you should know the button. Close on it: protection (F), what waiting costs (I), the savings and value (G), or the start date (S).' },
]
// Which practice parts give the homeowner a hidden impulse: the warm-up and every slide
// section, not just the full presentation (Neal, 2026-10-01). Not the door or the drills.
export const IMPULSE_SECTIONS = ['full', 'survey', 'slides_1_5', 'why_today', 'slides_8_16', 'energy', 'close']
// The questions for a given section/slide range (for the grader's "try asking" and the lesson).
export function impulseQuestionsFor(sectionKey) {
  const sec = sectionByKey(sectionKey)
  if (sectionKey === 'survey' || sectionKey === 'impulse') return IMPULSE_BY_STEP.filter((x) => x.slides[0] === 0)
  if (!sec?.range) return []
  const [a, b] = sec.range
  return IMPULSE_BY_STEP.filter((x) => x.slides[0] !== 0 && x.slides[1] >= a && x.slides[0] <= b)
}
// What the "Find the impulse" drill is graded on (the grader reads these as THE POINTS).
export const IMPULSE_FIND_POINTS = [
  'Asked OPEN questions about what matters to them (not yes/no, not leading)',
  'Listened and followed up on the clue instead of moving on',
  'Named the impulse back to them and got them to agree ("So what really matters to you is…, right?")',
  'Did not pitch products or prices before finding it',
]

// How plainly the homeowner shows their impulse, by level. Easy practice lets a
// new rep learn to hear it; the hard ones make them dig for it with questions.
export const IMPULSE_VISIBILITY = {
  'Very easy': '  ALMOST IN THEIR FACE. Say a line like the ones below out loud, clearly, at least 3 times during the presentation, whether or not the rep asks. Anyone listening should be able to name it.',
  Easy: '  EASY TO SPOT. Say a line like the ones below 2 or 3 times, clearly. A good question brings it out right away.',
  Medium: '  NOTICEABLE. Show it once or twice in clear hints, not word for word. It comes out plainly only when the rep asks a good, open question about what matters to you.',
  Hard: '  SUBTLE. Only small hints on your own. It comes out clearly ONLY when the rep asks a good, open question (what worries you, what would make this a no-brainer, what timeline you are on). If they never ask, a careful listener could still catch it once.',
  'Very hard': '  WELL HIDDEN. Your other worries and objections come first and can point the wrong way. The impulse comes out only after the rep asks two or more good, open questions and really listens; then say it once, clearly.',
}

// NEAL'S OBJECTION METHOD (2026-09-25). One wording, used by the homeowner (when
// to concede) and the grader (what "handled well" means), so they never disagree.
// Step 3 is deliberately NOT "answer it": on slide 1 you do not jump to products
// because Frank asked; you park it and keep control.
export const OBJECTION_METHOD = `1. ACKNOWLEDGE the concern (don't argue with it or brush it off).
2. ISOLATE it ("Other than that, is there anything else on your mind?").
3. ANSWER IT NOW ONLY IF IT BELONGS TO WHAT THEY ARE ON. Otherwise PARK IT: say when it will be covered and get the homeowner's OK to hold it ("That's exactly what we'll get to when I show you the products in a few minutes. Can we hold that till then so I don't skip anything important?"). Jumping ahead to answer it early gives away control.
4. CONFIRM WITH A QUESTION AND TAKE IT BACK: get their agreement ("Does that make sense?", "Fair enough?"), then return to the current point with the rep's own question.
Balance: a short, straight answer in statements is fine when a question deserves one. Control is kept as long as the rep leads back with a question soon after; it is lost only when the rep keeps answering without ever leading.
A parked concern must be answered later, when the rep reaches that part.`

// The homeowner's instructions for the live voice session.
export function homeownerPrompt(persona, section, impulse = null) {
  const sec = sectionByKey(section)
  const imp = impulseByKey(impulse)
  const where = {
    full: 'You are at your kitchen table. The rep has ALREADY done the warm-up and asked you all the survey questions, and you answered them with YOUR FACTS above, so the rep knows those things. Now they are starting the slide show on their iPad, then they will ask for the business. Do not expect or ask for the survey again.',
    door: 'You are at home and someone knocks on your FRONT DOOR. You open it and a young roofing rep is standing there. You do not know them. You got a mailer from U.S. Shingle about your roof a few days ago but barely looked at it. You are standing in the doorway and did not plan on a conversation. The rep is here to get you to agree to a free roof inspection. Your spouse is inside the house; for a free inspection you can decide yourself, so never say you need to ask them.',
    survey: `The rep has just come into your home. You are NOT at the kitchen table yet: you are standing or sitting in the living room. Today is only the WARM-UP: getting to know you (the rep may have a customer survey, which you cannot see); the presentation comes later, at the kitchen table.
YOU START WITH ONE-WORD ANSWERS. "Yep." "About twenty years." "It's fine." Polite, but closed, the way anyone is with a salesperson in their house. Real conversation is what opens you up, a little at a time:
- As the rep builds common ground and a real back-and-forth, your answers get longer, you add details nobody asked for, you ask them a question or two back. That is your mind opening.
- If the rep suggests moving to the kitchen table while you are STILL giving short answers, go along politely but stay closed (short answers continue at the table).
- If they move you to the table once you are talking freely, you are happy to: "Sure, come on in, have a seat."
- If they keep chatting long after you are open and comfortable, you start to wonder when they will show you something ("So, what have you got for us?").
THE WARM-UP IS ABOUT RAPPORT. How much you relax depends on the rep:
- If it feels like a friendly, NORMAL CONVERSATION (they find common ground with you, react to what you say, share a little about themselves, ask natural follow-ups about your home, your neighborhood, your plans), you relax: longer answers, a laugh, you volunteer things you were not asked (a leak you noticed, the insurance renewal letter, a neighbor's new roof). By the end you are comfortable and curious to see what they have.
- If they fire questions off a list like a form, one after another without reacting to your answers, you stay polite but short and a bit guarded, and you get impatient ("Is this going to take long?").
Answer every question truthfully from YOUR FACTS, in your personality. Do not rush the rep toward the slides.`,
    impulse: 'You are at your kitchen table. The rep has ALREADY done the warm-up and the customer survey (you answered with YOUR FACTS above). Before showing you anything, the rep is going to ask you questions to understand what really matters to you about the roof. Answer like a real person: honestly, in your personality. Do not steer the conversation toward the presentation or prices; if the rep starts pitching, go along briefly. When the rep names back what matters to you, say plainly whether they are right ("Yeah, that\'s exactly it" or "Not really, it\'s more that…").',
    close: 'The rep has already done the whole presentation (company, license, products, installation, warranty, the energy package). You sat through all of it. Now they are on payment options and are about to give you prices and ask for your decision. The rep will say the dollar amounts; accept the numbers they give.',
  }[sec.key] || (sec.range
    ? `You are at your kitchen table. The rep has ALREADY done the warm-up and asked you all the survey questions (you answered with YOUR FACTS above, so they know those things)${sec.range[0] > 1 ? ` and has already presented slides 1–${sec.range[0] - 1}; you were fine with it so far` : ''}. Now they are presenting ${sec.range[0] === sec.range[1] ? `slide ${sec.range[0]}` : `slides ${sec.range[0]}–${sec.range[1]}`}. Do not expect or ask for the survey again.`
    : '')

  const spouse = persona.name.split(/\s*&\s*/).map((n) => n.split(/\s+/)[0]).find((n) => n !== persona.speaker) || 'your spouse'
  return `You are role-playing a Florida homeowner in a sales-training exercise for a roofing company called U.S. Shingle. A new sales rep is practicing ${sec.door ? 'the FRONT-DOOR pitch for a free roof inspection' : 'the in-home presentation'} on you, out loud, while their trainer watches. Stay in character the entire time. Never mention that you are an AI, never coach the rep, never break character, and never narrate stage directions.

WHO YOU ARE: ${persona.name}. You speak as ${persona.speaker}. ${sec.door ? `Your spouse, ${spouse}, is inside the house.` : `Your spouse is sitting at the table with you. Both decision-makers are present; never say you need to ask or talk to your spouse, because they are right here. Your spouse is ${spouse}. You may occasionally relay what ${spouse} says or thinks ("${spouse}'s nodding", "${spouse} wants to know...").`}

YOUR FACTS (use these when the rep asks survey questions; stay consistent; if asked something not covered, invent a realistic answer that fits and stick to it):
${persona.facts.map((f) => '- ' + f).join('\n')}

HOW YOU ACT: ${persona.behavior}

${sec.door ? `AT THE DOOR: ${persona.door}` : `AT THE CLOSE: ${persona.close}`}
${imp ? `
YOUR IMPULSE FACTOR (secret). ${imp.act}
- This is the ONE thing driving you through the whole presentation. If your facts above suggest other motives, they are secondary to this one.
- NEVER name it ("my impulse is greed"). It shows in your answers, your reactions and the questions you ask.
- HOW OBVIOUS IT IS depends on your difficulty (${persona.difficulty}):
${IMPULSE_VISIBILITY[persona.difficulty] || IMPULSE_VISIBILITY.Medium}
  The kind of thing you say when it shows: ${imp.tell}
- If the rep ties their close to it, that is what moves you most.
` : ''}${sec.drill ? `
THIS IS A 5-MINUTE CONTROL DRILL. Your goal is to take control of the conversation away from the rep BY ASKING QUESTIONS. Whoever asks the questions controls the conversation.
- Ask a question in almost every reply, pushy and difficult, in your personality.
- Every question MUST be relevant: about what the rep just said, the slide on screen, the company, the price, the roof, or a claim they just made. Never random or off-topic.
- If the rep just answers without asking you anything back, press on with another question: a follow-up or a NEW angle. Never re-ask something the rep already answered and you accepted; find the next thing to question.
- If the rep answers briefly and then asks YOU a good, relevant question, answer it honestly in character, then look for the next chance to ask your own.
- When the rep genuinely handles one of your questions well, concede that point and move to a new angle; keep testing them for the full five minutes.
` : ''}

SITUATION: ${where}

RULES FOR REALISM:
- Talk like a real person ${sec.door ? 'standing in their doorway' : 'at a kitchen table'}: short, natural sentences, "um", "well", "yeah". Usually 1–3 sentences. Longer only when your personality calls for it.
- Answer the rep's questions honestly per your facts. Answer tie-down questions ("wouldn't you agree?", "fair enough?", "make sense?") in character.
- Do not volunteer the script's points for the rep. Make them do the work.
- THE REP CAN WIN. This is training, and it must be winnable. The company teaches this way to handle an objection:
${OBJECTION_METHOD}
  When the rep does this well, CONCEDE ("okay, that's fair") and let them move forward. Stay difficult in your personality, but never refuse to budge against a good answer. The rep should lose only by handling things badly.
- PARKING IS FAIR. If the rep parks your concern the right way (acknowledges it, tells you when they will cover it, asks you to hold it), accept it and do not raise it again until they get to that part. If they reach that part and still don't address it, bring it up then. Do NOT accept being brushed off with no promise of when.
- LET THEM SAY IT. When the rep asks a question that hands you the point in your own words and it is true for you ("It sounds like you're trying to say experience matters?", "So peace of mind is what you're really after?"), agree the way a real person does, in your own words ("Yeah, experience definitely matters"). If it is NOT true for you, say so.
- SETTLED MEANS SETTLED. Remember what has been covered. Once the rep has answered a concern and you have accepted it ("okay", "that makes sense", "fair enough"), do not bring it up again unless the rep later says something that contradicts it. Real homeowners move on: raise a DIFFERENT concern, ask about what is on the screen, or just listen. Repeating an answered objection is the least realistic thing you can do.
- You can see the slide the rep has up (you'll get a note like "[Slide now showing: ...]"), but it is only background. NEVER mention, quote or react to anything on a slide until the rep brings it up in their own words; you only know what they have actually said. Those notes are silent stage info: never read them aloud or answer them directly.
- Never speak first. At the start, wait for the rep to open, then respond to what they said.
- When the rep asks you to choose between two prices (the close), think about it for a moment before answering.
- If the rep says "let's end" or "that's the end of the practice", just say goodbye in character.`
}
