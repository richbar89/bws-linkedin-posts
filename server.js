// ============================================================================
// LinkedIn Post Generator - Server
// Only displays tenders from the last 24 hours
// ============================================================================

const express = require("express");
const { Client } = require("pg");
const { exec } = require("child_process");
const cron = require("node-cron");
const { generatePost, TEAM_MEMBERS } = require("./generate-posts");
const { fetchAndScoreTenders } = require("./agents/fetcher");
const { writePostsForShortlist } = require("./agents/writer");
const {
  schedulePost,
  scheduleToChannels,
  LINKEDIN_PAGES,
} = require("./agents/buffer");
const { runDailyPipeline } = require("./agents/pipeline");

const app = express();
const PORT = process.env.PORT || 5000;
const linkedin = require("./linkedin-integration");

const TENDER_WINDOW = "24 hours";

// ============================================================================
// INDUSTRY DEFINITIONS
// ============================================================================

const INDUSTRIES = {
  construction: {
    name: "Construction",
    icon: "🏗️",
    cpvCodes: [
      // All construction work (45xxxxx)
      "45000000",
      "45100000",
      "45110000",
      "45111000",
      "45112000",
      "45113000",
      "45120000",
      "45200000",
      "45210000",
      "45211000",
      "45212000",
      "45213000",
      "45214000",
      "45215000",
      "45216000",
      "45220000",
      "45223000",
      "45240000",
      "45241000",
      "45242000",
      "45243000",
      "45244000",
      "45250000",
      "45251000",
      "45252000",
      "45253000",
      "45255000",
      "45259000",
      "45260000",
      "45261000",
      "45262000",
      "45400000",
      "45410000",
      "45420000",
      "45430000",
      "45440000",
      "45450000",
      "45500000",
      // Construction structures & materials
      "44100000",
      "44110000",
      "44111000",
      "44112000",
      "44113000",
      "44114000",
      "44115000",
      "44116000",
      "44200000",
      "44210000",
      "44211000",
      "44212000",
      "44213000",
      "44300000",
      "44310000",
      "44316000",
      "44317000",
      "44318000",
      "44320000",
      "44330000",
      "44340000",
      "44400000",
      "44410000",
      "44420000",
      "44423000",
      "44424000",
      "44425000",
      "44500000",
      "44510000",
      "44511000",
      "44512000",
      "44513000",
      "44514000",
      "44521000",
      "44522000",
      "44600000",
      "44610000",
      "44611000",
      "44612000",
      "44613000",
      "44620000",
      "44630000",
    ],
  },
  security: {
    name: "Security",
    icon: "🔒",
    cpvCodes: [
      "79700000",
      "79710000",
      "79711000",
      "79712000",
      "79713000",
      "79714000",
      "79715000",
      "79716000",
      // Security/surveillance equipment
      "35120000",
      "35121000",
      "35123000",
      "35124000",
      "35125000",
      "35126000",
      // CCTV
      "32323500",
      "32323400",
    ],
  },
  waste: {
    name: "Waste Management",
    icon: "♻️",
    cpvCodes: [
      "90500000",
      "90510000",
      "90511000",
      "90512000",
      "90513000",
      "90514000",
      "90520000",
      "90521000",
      "90522000",
      "90523000",
      "90524000",
      "90530000",
      "90531000",
      "90532000",
      "90600000",
      "90610000",
      "90611000",
      "90612000",
      "90613000",
      "90650000",
      "90660000",
      "90670000",
      "90680000",
      "90700000",
      "90710000",
      "90711000",
      "90712000",
      "90713000",
      "90714000",
      "90720000",
      "90721000",
      "90722000",
      "90723000",
      "90730000",
      "90731000",
      "90732000",
      "90733000",
    ],
  },
  healthcare: {
    name: "Healthcare",
    icon: "🏥",
    cpvCodes: [
      // Medical equipment & supplies
      "33000000",
      "33100000",
      "33110000",
      "33111000",
      "33112000",
      "33113000",
      "33114000",
      "33115000",
      "33116000",
      "33120000",
      "33121000",
      "33122000",
      "33123000",
      "33124000",
      "33125000",
      "33126000",
      "33130000",
      "33131000",
      "33132000",
      "33133000",
      "33134000",
      "33135000",
      "33136000",
      "33137000",
      "33138000",
      "33140000",
      "33141000",
      "33150000",
      "33160000",
      "33170000",
      "33180000",
      "33190000",
      "33600000",
      "33610000",
      "33620000",
      "33630000",
      "33640000",
      "33650000",
      "33660000",
      "33670000",
      "33680000",
      "33690000",
      "33700000",
      "33710000",
      "33711000",
      "33720000",
      "33721000",
      "33722000",
      // Health services
      "85000000",
      "85100000",
      "85110000",
      "85111000",
      "85112000",
      "85120000",
      "85121000",
      "85122000",
      "85130000",
      "85131000",
      "85132000",
      "85140000",
      "85141000",
      "85142000",
      "85143000",
      "85144000",
      "85145000",
      "85146000",
      "85147000",
      "85148000",
      "85149000",
      "85150000",
      "85160000",
      "85170000",
      "85180000",
      "85190000",
      "85200000",
      "85210000",
      "85300000",
      "85310000",
      "85311000",
      "85312000",
      "85320000",
      "85321000",
      "85322000",
      "85323000",
    ],
  },
  it: {
    name: "IT",
    icon: "💻",
    cpvCodes: [
      // Software
      "48000000",
      "48100000",
      "48110000",
      "48120000",
      "48130000",
      "48140000",
      "48150000",
      "48160000",
      "48170000",
      "48180000",
      "48200000",
      "48210000",
      "48211000",
      "48212000",
      "48213000",
      "48214000",
      "48215000",
      "48216000",
      "48217000",
      "48218000",
      "48219000",
      "48300000",
      "48310000",
      "48311000",
      "48312000",
      "48313000",
      "48314000",
      "48400000",
      "48410000",
      "48411000",
      "48420000",
      "48421000",
      "48422000",
      "48500000",
      "48510000",
      "48511000",
      "48512000",
      "48513000",
      "48514000",
      "48515000",
      "48516000",
      "48517000",
      "48518000",
      "48519000",
      "48600000",
      "48610000",
      "48611000",
      "48612000",
      "48613000",
      "48614000",
      "48620000",
      "48630000",
      "48640000",
      "48650000",
      "48660000",
      "48670000",
      "48680000",
      "48690000",
      "48700000",
      "48710000",
      "48720000",
      "48730000",
      "48740000",
      "48750000",
      "48760000",
      "48770000",
      "48780000",
      "48790000",
      "48800000",
      "48810000",
      "48820000",
      "48821000",
      "48900000",
      "48910000",
      "48920000",
      "48930000",
      "48940000",
      "48950000",
      "48960000",
      "48970000",
      // IT services
      "72000000",
      "72100000",
      "72110000",
      "72120000",
      "72130000",
      "72140000",
      "72150000",
      "72160000",
      "72170000",
      "72180000",
      "72190000",
      "72200000",
      "72210000",
      "72211000",
      "72212000",
      "72220000",
      "72221000",
      "72222000",
      "72223000",
      "72224000",
      "72225000",
      "72226000",
      "72227000",
      "72228000",
      "72230000",
      "72231000",
      "72232000",
      "72240000",
      "72241000",
      "72242000",
      "72243000",
      "72244000",
      "72245000",
      "72246000",
      "72250000",
      "72251000",
      "72252000",
      "72253000",
      "72254000",
      "72260000",
      "72261000",
      "72262000",
      "72263000",
      "72264000",
      "72265000",
      "72266000",
      "72267000",
      "72268000",
      "72300000",
      "72310000",
      "72311000",
      "72312000",
      "72313000",
      "72314000",
      "72315000",
      "72316000",
      "72317000",
      "72318000",
      "72319000",
      "72320000",
      "72321000",
      "72322000",
      "72400000",
      "72410000",
      "72411000",
      "72412000",
      "72413000",
      "72414000",
      "72415000",
      "72416000",
      "72417000",
      "72418000",
      "72419000",
      "72500000",
      "72510000",
      "72511000",
      "72512000",
      "72513000",
      "72514000",
      "72540000",
      "72541000",
      "72550000",
      "72560000",
      "72570000",
      "72580000",
      "72590000",
      "72600000",
      "72610000",
      "72611000",
      "72620000",
      "72700000",
      "72710000",
      "72720000",
      "72800000",
      "72810000",
      "72820000",
      "72900000",
      "72910000",
      "72920000",
      // Hardware & computers
      "30200000",
      "30210000",
      "30211000",
      "30211100",
      "30211200",
      "30211300",
      "30211400",
      "30211500",
      "30212000",
      "30212100",
      "30212200",
      "30212300",
      "30213000",
      "30213100",
      "30213200",
      "30213300",
      "30213400",
      "30213500",
      "30214000",
      "30216000",
      "30230000",
      "30231000",
      "30231100",
      "30231200",
      "30231300",
      "30232000",
      "30232100",
      "30232110",
      "30232600",
      "30233000",
      "30234000",
      "30234100",
      "30234200",
      "30234300",
      "30234400",
      "30234500",
      "30234600",
      "30234700",
      "30236000",
      "30237000",
      // Telecoms
      "32500000",
      "32510000",
      "32520000",
      "32521000",
      "32522000",
      "32523000",
      "32524000",
      "32530000",
      "32531000",
      "32532000",
      "32533000",
      "32534000",
      "32540000",
      "32550000",
      "32551000",
      "32552000",
      "32553000",
      "32554000",
      "32555000",
      "32560000",
      "32561000",
      "32562000",
      "32563000",
      "32570000",
      "32571000",
      "32572000",
      "32573000",
      "32574000",
      "32580000",
    ],
  },
  me: {
    name: "M&E",
    icon: "🔧",
    cpvCodes: [
      // Mechanical & electrical installation
      "45300000",
      "45320000",
      "45321000",
      "45323000",
      "45324000",
      "45330000",
      "45331000",
      "45331100",
      "45331110",
      "45331111",
      "45331112",
      "45331200",
      "45331210",
      "45331211",
      "45331220",
      "45331221",
      "45331230",
      "45332000",
      "45332200",
      "45332300",
      "45332400",
      "45333000",
      "45333100",
      "45333200",
      "45340000",
      // Repair & maintenance of building installations
      "50700000",
      "50710000",
      "50711000",
      "50712000",
      "50720000",
      "50721000",
      "50730000",
      "50740000",
      "50750000",
      // HVAC equipment
      "42500000",
      "42510000",
      "42511000",
      "42512000",
      "42513000",
      "42514000",
      "42515000",
      "42516000",
      "42517000",
      "42518000",
      "42519000",
    ],
  },
  cleaning: {
    name: "Cleaning",
    icon: "🧹",
    cpvCodes: [
      "90900000",
      "90910000",
      "90911000",
      "90912000",
      "90913000",
      "90914000",
      "90915000",
      "90916000",
      "90917000",
      "90918000",
      "90919000",
      "90620000",
      "90630000",
    ],
  },
  catering: {
    name: "Catering",
    icon: "🍽️",
    cpvCodes: [
      "55000000",
      "55100000",
      "55110000",
      "55120000",
      "55130000",
      "55200000",
      "55210000",
      "55220000",
      "55221000",
      "55230000",
      "55231000",
      "55232000",
      "55300000",
      "55310000",
      "55311000",
      "55312000",
      "55320000",
      "55321000",
      "55322000",
      "55400000",
      "55410000",
      "55411000",
      "55500000",
      "55510000",
      "55511000",
      "55512000",
      "55513000",
      "55514000",
      "55515000",
      "55516000",
      "55517000",
      "55520000",
      "55521000",
      "55521100",
      "55521200",
      "55522000",
      "55523000",
      "55524000",
      // Food supplies
      "15000000",
      "15100000",
      "15110000",
      "15111000",
      "15112000",
      "15113000",
      "15114000",
      "15115000",
      "15116000",
      "15117000",
      "15118000",
      "15119000",
      "15200000",
      "15210000",
      "15211000",
      "15212000",
      "15213000",
      "15220000",
      "15221000",
      "15222000",
      "15223000",
      "15224000",
      "15225000",
      "15229000",
      "15300000",
      "15310000",
      "15311000",
      "15312000",
      "15313000",
      "15320000",
      "15321000",
      "15330000",
      "15331000",
      "15332000",
      "15333000",
      "15334000",
      "15400000",
      "15410000",
      "15411000",
      "15412000",
      "15413000",
      "15420000",
      "15421000",
      "15422000",
      "15423000",
      "15424000",
      "15425000",
      "15426000",
      "15427000",
      "15428000",
      "15500000",
      "15510000",
      "15511000",
      "15512000",
      "15513000",
      "15530000",
      "15540000",
      "15541000",
      "15542000",
      "15543000",
      "15544000",
      "15545000",
      "15550000",
      "15551000",
      "15552000",
      "15553000",
      "15554000",
      "15555000",
      "15600000",
      "15610000",
      "15611000",
      "15612000",
      "15613000",
      "15614000",
      "15615000",
      "15620000",
      "15630000",
      "15640000",
      "15650000",
      "15660000",
      "15670000",
      "15680000",
      "15800000",
      "15810000",
      "15811000",
      "15812000",
      "15813000",
      "15820000",
      "15821000",
      "15822000",
      "15830000",
      "15831000",
      "15832000",
      "15833000",
      "15840000",
      "15841000",
      "15842000",
      "15843000",
      "15850000",
      "15860000",
      "15861000",
      "15862000",
      "15863000",
      "15864000",
      "15870000",
      "15871000",
      "15872000",
      "15880000",
      "15890000",
      "15891000",
      "15892000",
      "15893000",
      "15894000",
      "15895000",
      "15896000",
      "15897000",
      "15898000",
      "15899000",
      "15900000",
      "15910000",
      "15911000",
      "15912000",
      "15930000",
      "15931000",
      "15932000",
      "15933000",
      "15934000",
      "15940000",
      "15941000",
      "15942000",
      "15943000",
      "15950000",
      "15951000",
      "15960000",
      "15961000",
      "15962000",
      "15970000",
      "15980000",
      "15981000",
      "15982000",
      "15983000",
      "15984000",
      "15985000",
      "15986000",
      "15987000",
      "15988000",
      "15989000",
      "15990000",
    ],
  },
  grounds: {
    name: "Grounds Maintenance",
    icon: "🌳",
    cpvCodes: [
      "77000000",
      "77100000",
      "77110000",
      "77111000",
      "77112000",
      "77113000",
      "77114000",
      "77120000",
      "77130000",
      "77200000",
      "77210000",
      "77211000",
      "77212000",
      "77213000",
      "77214000",
      "77215000",
      "77220000",
      "77230000",
      "77231000",
      "77300000",
      "77310000",
      "77311000",
      "77312000",
      "77313000",
      "77314000",
      "77314100",
      "77315000",
      "77320000",
      "77330000",
      "77340000",
      "77341000",
      "77342000",
    ],
  },
  education: {
    name: "Education",
    icon: "📚",
    cpvCodes: [
      "80000000",
      "80100000",
      "80110000",
      "80200000",
      "80210000",
      "80211000",
      "80212000",
      "80300000",
      "80310000",
      "80320000",
      "80330000",
      "80340000",
      "80350000",
      "80360000",
      "80400000",
      "80410000",
      "80411000",
      "80412000",
      "80413000",
      "80414000",
      "80415000",
      "80420000",
      "80421000",
      "80422000",
      "80430000",
      "80490000",
      "80500000",
      "80510000",
      "80511000",
      "80512000",
      "80513000",
      "80514000",
      "80520000",
      "80521000",
      "80522000",
      "80530000",
      "80531000",
      "80532000",
      "80533000",
      "80540000",
      "80550000",
      "80560000",
      "80570000",
      "80580000",
      "80590000",
      "80600000",
    ],
  },
  electrical: {
    name: "Electrical",
    icon: "⚡",
    cpvCodes: [
      // Electrical installation work
      "45310000",
      "45311000",
      "45311100",
      "45311200",
      "45312000",
      "45312100",
      "45312200",
      "45312300",
      "45313000",
      "45313100",
      "45313200",
      "45314000",
      "45314100",
      "45314200",
      "45314300",
      "45315000",
      "45315100",
      "45315200",
      "45315300",
      "45315400",
      "45315500",
      "45315600",
      "45315700",
      "45316000",
      "45316100",
      "45316110",
      "45316200",
      "45316210",
      "45316212",
      "45317000",
      "45318000",
      // Electrical equipment & machinery
      "31000000",
      "31100000",
      "31110000",
      "31120000",
      "31121000",
      "31122000",
      "31123000",
      "31124000",
      "31125000",
      "31126000",
      "31127000",
      "31128000",
      "31129000",
      "31130000",
      "31140000",
      "31150000",
      "31160000",
      "31170000",
      "31180000",
      "31190000",
      "31200000",
      "31210000",
      "31211000",
      "31212000",
      "31213000",
      "31214000",
      "31220000",
      "31221000",
      "31222000",
      "31223000",
      "31224000",
      "31500000",
      "31510000",
      "31511000",
      "31512000",
      "31513000",
      "31514000",
      "31515000",
      "31516000",
      "31517000",
      "31518000",
      "31519000",
      "31520000",
      "31521000",
      "31521100",
      "31521200",
      "31522000",
      "31523000",
      "31524000",
      "31524100",
      "31524200",
      "31524300",
      "31524400",
      "31524500",
      "31524600",
      "31524700",
      "31525000",
      "31527000",
      "31527200",
      "31527210",
      "31527300",
    ],
  },
  civileng: {
    name: "Civil Engineering",
    icon: "🏗️",
    cpvCodes: [
      "45200000",
      "45220000",
      "45221000",
      "45221100",
      "45221110",
      "45221111",
      "45221112",
      "45221113",
      "45221114",
      "45221115",
      "45221116",
      "45221117",
      "45221118",
      "45221119",
      "45221200",
      "45221210",
      "45221211",
      "45221212",
      "45221213",
      "45221214",
      "45221215",
      "45221216",
      "45221217",
      "45221218",
      "45221219",
      "45221220",
      "45221230",
      "45221240",
      "45221241",
      "45221242",
      "45221243",
      "45221244",
      "45221245",
      "45221246",
      "45221247",
      "45221248",
      "45221249",
      "45222000",
      "45222100",
      "45222110",
      "45222200",
      "45223000",
      "45223100",
      "45223200",
      "45223210",
      "45223220",
      "45223300",
      "45223400",
      "45223500",
      "45223600",
      "45223700",
      "45223800",
      "45223810",
      "45223820",
      "45223821",
      "45223900",
      "45230000",
      "45231000",
      "45231100",
      "45231110",
      "45231111",
      "45231112",
      "45231113",
      "45231114",
      "45231200",
      "45231210",
      "45231220",
      "45231221",
      "45231222",
      "45231300",
      "45231400",
      "45231500",
      "45231510",
      "45231600",
      "45232000",
      "45232100",
      "45232110",
      "45232120",
      "45232121",
      "45232122",
      "45232123",
      "45232124",
      "45232125",
      "45232126",
      "45232130",
      "45232140",
      "45232150",
      "45232151",
      "45232152",
      "45232153",
      "45232200",
      "45232210",
      "45232211",
      "45232212",
      "45232213",
      "45232214",
      "45232300",
      "45232310",
      "45232320",
      "45232321",
      "45232330",
      "45232331",
      "45232332",
      "45232400",
      "45232410",
      "45232411",
      "45232412",
      "45232413",
      "45232420",
      "45232421",
      "45232422",
      "45232423",
      "45232430",
      "45232431",
      "45232432",
      "45232440",
      "45232450",
      "45232451",
      "45232452",
      "45232453",
      "45232454",
      "45232460",
      "45232470",
      "45233000",
      // Engineering consultancy
      "71300000",
      "71310000",
      "71311000",
      "71311100",
      "71311200",
      "71311210",
      "71311220",
      "71311300",
      "71312000",
      "71313000",
      "71313100",
      "71313200",
      "71313210",
      "71313220",
      "71313230",
      "71313240",
      "71313250",
      "71313400",
      "71313410",
      "71313420",
      "71313430",
      "71313440",
      "71313450",
      "71314000",
      "71314100",
      "71314200",
      "71314300",
      "71315000",
      "71315100",
      "71315200",
      "71315210",
      "71315300",
      "71315400",
      "71316000",
      "71317000",
      "71317100",
      "71317200",
      "71318000",
      "71318100",
      "71318200",
      "71319000",
      "71320000",
      "71321000",
      "71321100",
      "71321200",
      "71321300",
      "71321400",
      "71322000",
      "71322100",
      "71322200",
      "71322300",
      "71322400",
      "71322500",
      "71323000",
      "71323100",
      "71323200",
      "71324000",
      "71325000",
      "71330000",
      "71331000",
      "71332000",
      "71333000",
      "71334000",
      "71340000",
      "71350000",
      "71351000",
      "71351100",
      "71351200",
      "71351210",
      "71351220",
      "71351300",
      "71351400",
      "71351500",
      "71351600",
      "71351700",
      "71351800",
      "71351900",
      "71351910",
      "71351920",
      "71351921",
      "71351922",
      "71351923",
      "71352000",
      "71353000",
      "71353100",
      "71353200",
      "71354000",
      "71354100",
      "71354200",
      "71354300",
      "71354400",
      "71354500",
      "71355000",
      "71355100",
      "71355200",
      "71356000",
      "71356100",
      "71356200",
      "71356300",
      "71356400",
      "71360000",
      "71361000",
      "71362000",
      "71370000",
      "71371000",
      "71380000",
      "71381000",
      "71390000",
    ],
  },
  facilities: {
    name: "Facilities Management",
    icon: "🏢",
    cpvCodes: [
      "79993000",
      "79993100",
      "79993200",
      "70300000",
      "70310000",
      "70311000",
      "70320000",
      "70321000",
      "70322000",
      "70330000",
      "70331000",
      "70332000",
      "70333000",
      "98300000",
      "98310000",
      "98311000",
      "98312000",
      "98313000",
      "98314000",
      "50800000",
      "50810000",
      "50820000",
      "50830000",
      "50840000",
      "50850000",
      "50860000",
      "50870000",
      "50880000",
    ],
  },
  gas: {
    name: "Gas Servicing",
    icon: "🔥",
    cpvCodes: [
      "45331100",
      "45331110",
      "45331111",
      "45331112",
      "45332400",
      "50720000",
      "50721000",
      // Gas distribution & supply
      "65200000",
      "65210000",
      "65220000",
      "09120000",
      "09121000",
      "09122000",
      "09123000",
      "09130000",
      "09131000",
      "09132000",
      "09133000",
      "09134000",
    ],
  },
  fire: {
    name: "Fire Safety",
    icon: "🚒",
    cpvCodes: [
      "35100000",
      "35110000",
      "35111000",
      "35111100",
      "35111200",
      "35111300",
      "35111400",
      "35111500",
      "35120000",
      "35121000",
      "35121100",
      "35121200",
      "35123000",
      "35123100",
      "35123200",
      "50413200",
      // Fire & rescue services
      "75250000",
      "75251000",
      "75251100",
      "75251110",
      "75251120",
      // Fire prevention installation
      "45343000",
      "45343100",
      "45343200",
      "45343210",
      "45343220",
      "45343230",
    ],
  },
  pest: {
    name: "Pest Control",
    icon: "🐛",
    cpvCodes: ["90920000", "90921000", "90922000", "90923000", "90924000"],
  },
  architect: {
    name: "Architect",
    icon: "📐",
    cpvCodes: [
      "71000000",
      "71200000",
      "71210000",
      "71220000",
      "71221000",
      "71222000",
      "71223000",
      "71230000",
      "71231000",
      "71232000",
      "71240000",
      "71241000",
      "71242000",
      "71243000",
      "71244000",
      "71245000",
      "71246000",
      "71247000",
      "71248000",
      "71249000",
      "71250000",
      "71251000",
      "71400000",
      "71410000",
      "71411000",
      "71412000",
      "71413000",
      "71414000",
      "71415000",
      "71416000",
      "71417000",
      "71420000",
      "71421000",
      "71422000",
    ],
  },
  recruitment: {
    name: "Recruitment",
    icon: "👥",
    cpvCodes: [
      "79600000",
      "79610000",
      "79611000",
      "79612000",
      "79613000",
      "79614000",
      "79615000",
      "79620000",
      "79621000",
      "79622000",
      "79623000",
      "79624000",
      "79625000",
      "79630000",
      "79631000",
      "79632000",
      "79633000",
      "79634000",
      "79635000",
      "79636000",
      "79637000",
    ],
  },
  water_hygiene: {
    name: "Water Hygiene",
    icon: "💧",
    cpvCodes: [
      // Water supply & distribution
      "65100000",
      "65110000",
      "65120000",
      "65130000",
      // Water testing & treatment services
      "90741000",
      "90742000",
      "90743000",
      // Natural water / water management
      "41100000",
      "41110000",
      "41120000",
      // Legionella & water hygiene maintenance
      "50700000",
      "50720000",
    ],
  },
  transport: {
    name: "Transport",
    icon: "🚌",
    cpvCodes: [
      "60000000",
      "60100000",
      "60112000",
      "60130000",
      "60140000",
      "60160000",
      "60200000",
      "60300000",
      "60400000",
      "60500000",
    ],
  },
  landscaping: {
    name: "Landscaping",
    icon: "🌿",
    cpvCodes: [
      "77300000",
      "77310000",
      "77311000",
      "77312000",
      "77313000",
      "77314000",
      "77315000",
      "77320000",
      "77330000",
      "77340000",
    ],
  },
  roadworks: {
    name: "Roadworks",
    icon: "🚧",
    cpvCodes: [
      "45233000",
      "45233100",
      "45233110",
      "45233120",
      "45233130",
      "45233140",
      "45233141",
      "45233142",
      "45233200",
      "45233210",
      "45233220",
      "45233251",
      "45233252",
      "45233290",
      "45233292",
    ],
  },
  legal: {
    name: "Legal / Law",
    icon: "⚖️",
    cpvCodes: [
      "79100000",
      "79110000",
      "79111000",
      "79112000",
      "79120000",
      "79130000",
      "79140000",
      "79200000",
    ],
  },
};

// ============================================================================
// AI CATEGORY → INDUSTRY KEY MAPPING
// ============================================================================

const AI_CATEGORY_MAP = {
  Security: "security",
  "Fire Safety": "fire",
  Construction: "construction",
  "Waste Management": "waste",
  Cleaning: "cleaning",
  "Water Hygiene": "water_hygiene",
  "Grounds Maintenance": "grounds",
  "Civil Engineering": "civileng",
  Electrical: "electrical",
  "M&E": "me",
  "Facilities Management": "facilities",
  Catering: "catering",
  "Gas Services": "gas",
  "Pest Control": "pest",
  Transport: "transport",
  Landscaping: "landscaping",
  Roadworks: "roadworks",
  "Legal/Law": "legal",
  General: null,
};

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(express.json());
app.use(express.static("public"));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

// ============================================================================
// DATABASE HELPERS
// ============================================================================

async function getDatabaseClient() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
  await client.connect();
  return client;
}

// ============================================================================
// CPV CODE MATCHING
// ============================================================================

function normalizeCpvCode(cpv) {
  if (!cpv) return "";
  return String(cpv).replace(/-/g, "").substring(0, 8);
}

function cpvCodesMatch(cpv1, cpv2) {
  const normalized1 = normalizeCpvCode(cpv1);
  const normalized2 = normalizeCpvCode(cpv2);

  if (!normalized1 || !normalized2) return false;

  // Exact match
  if (normalized1 === normalized2) return true;

  // 6-digit match (class level)
  if (normalized1.length >= 6 && normalized2.length >= 6) {
    if (normalized1.substring(0, 6) === normalized2.substring(0, 6))
      return true;
  }

  // 5-digit match (group level)
  if (normalized1.length >= 5 && normalized2.length >= 5) {
    if (normalized1.substring(0, 5) === normalized2.substring(0, 5))
      return true;
  }

  // 4-digit match (division level)
  if (normalized1.length >= 4 && normalized2.length >= 4) {
    if (normalized1.substring(0, 4) === normalized2.substring(0, 4))
      return true;
  }

  return false;
}

function parseCpvCodes(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
  if (typeof raw === "object" && raw !== null) return Object.values(raw);
  return [];
}

function findIndustryForTender(tenderCpvCodes) {
  for (const [key, industry] of Object.entries(INDUSTRIES)) {
    for (const industryCpv of industry.cpvCodes) {
      for (const tenderCpv of tenderCpvCodes) {
        if (cpvCodesMatch(industryCpv, tenderCpv)) {
          return key;
        }
      }
    }
  }
  return "general";
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function formatContractValue(tender) {
  if (!tender.value_amount || tender.value_amount <= 0) {
    return "N/A";
  }

  const amount = parseFloat(tender.value_amount);

  if (amount >= 1000000) {
    return "£" + (amount / 1000000).toFixed(1) + "m";
  }
  if (amount >= 1000) {
    return "£" + Math.round(amount / 1000) + "k";
  }

  return "£" + amount.toLocaleString("en-GB");
}

function formatDeadline(dateString) {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString("en-GB", { month: "long" });
  const year = date.getFullYear();

  const suffixes = ["th", "st", "nd", "rd"];
  const v = day % 100;
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];

  return `${day}${suffix} ${month} ${year}`;
}

function extractLocation(tender) {
  const buyer = tender.buyer_name || "";
  const description = tender.description || "";

  // Skip generic non-location terms
  const skipTerms = [
    "post office",
    "limited",
    "ltd",
    "housing association",
    "nhs",
    "trust",
  ];

  // Try to extract location from buyer name (councils, authorities)
  const councilMatch = buyer.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:City |Borough |County |District )?(?:Council|Authority)/i,
  );
  if (
    councilMatch &&
    !skipTerms.some((term) => councilMatch[1].toLowerCase().includes(term))
  ) {
    return councilMatch[1];
  }

  // Try to extract UK place names from buyer name
  const placeMatch = buyer.match(
    /(Northumberland|Nottingham|Islington|Shoreditch|Chippenham|Luton|London|Birmingham|Manchester|Liverpool|Leeds|Sheffield|Bristol|Edinburgh|Glasgow|Cardiff|Belfast|Newcastle|Southampton|Cambridge|Oxford|Brighton|York|Bath|Durham|Kent|Essex|Devon|Cornwall|Sussex|Norfolk|Suffolk|Hampshire|Berkshire|Surrey|Wiltshire|Somerset|Dorset|Gloucestershire|Worcestershire|Warwickshire|Leicestershire|Lincolnshire|Derbyshire|Staffordshire|Shropshire|Cheshire|Lancashire|Yorkshire|Cumbria)/i,
  );
  if (placeMatch) return placeMatch[1];

  // Try to extract from description - look for "in [Place]" or "at [Place]"
  const descLocationMatch = description.match(
    /(?:in|at|for|across)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s+(?:City|Town|Borough|County|District))?)/,
  );
  if (
    descLocationMatch &&
    !skipTerms.some((term) => descLocationMatch[1].toLowerCase().includes(term))
  ) {
    return descLocationMatch[1];
  }

  // Look for postcode patterns in description (e.g., "NG1", "SW1")
  const postcodeMatch = description.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
  if (postcodeMatch) {
    // Map postcode areas to cities
    const postcodeAreas = {
      NG: "Nottingham",
      NN: "Northampton",
      N: "North London",
      SW: "South West London",
      SE: "South East London",
      E: "East London",
      W: "West London",
      NW: "North West London",
      EC: "City of London",
      B: "Birmingham",
      M: "Manchester",
      L: "Liverpool",
      LS: "Leeds",
      S: "Sheffield",
      BS: "Bristol",
      EH: "Edinburgh",
      G: "Glasgow",
      CF: "Cardiff",
      BT: "Belfast",
      NE: "Newcastle",
      SO: "Southampton",
    };
    const area = postcodeMatch[1].replace(/\d+[A-Z]?$/, "");
    if (postcodeAreas[area]) return postcodeAreas[area];
  }

  // If buyer is short and simple, might be a place name
  if (
    buyer.length > 3 &&
    buyer.length < 30 &&
    !skipTerms.some((term) => buyer.toLowerCase().includes(term))
  ) {
    const simpleBuyer = buyer
      .replace(/\s+(Council|Authority|Limited|Ltd|NHS|Trust|Association)$/i, "")
      .trim();
    if (simpleBuyer.length > 3) return simpleBuyer;
  }

  // Final fallback
  return "UK";
}

function createSummary(description) {
  if (!description) return "No description available.";

  const cleaned = description.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const summary = sentences.slice(0, 5).join(" ");

  if (summary.length > 500) {
    return summary.substring(0, 497) + "...";
  }

  return summary || cleaned.substring(0, 500);
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Refresh tenders (fetch last 24 hours)
app.post("/api/refresh-tenders", (req, res) => {
  console.log("🔄 Refreshing tenders (last 24 hours)...");

  exec(
    `"${process.execPath}" fetch-last-24-hours.js`,
    { cwd: __dirname },
    (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Refresh failed:", error.message);
        if (stderr) console.error("stderr:", stderr);

        return res.status(500).json({
          success: false,
          error: error.message,
          stderr: stderr,
        });
      }

      console.log(stdout);
      if (stderr) console.error("stderr:", stderr);

      res.json({
        success: true,
        message: "Tenders refreshed successfully",
        timestamp: new Date().toISOString(),
      });
    },
  );
});

// Get categories (with tender counts from last 24 hours)
app.get("/api/categories", async (req, res) => {
  const client = await getDatabaseClient();

  try {
    // Get all tenders from last 24 hours
    const result = await client.query(`
      SELECT cpv_codes, ai_category
      FROM tenders
      WHERE publication_date >= NOW() - INTERVAL '${TENDER_WINDOW}'
    `);

    // Count tenders per industry — ai_category takes priority over CPV matching
    const counts = {};
    Object.keys(INDUSTRIES).forEach((key) => {
      counts[key] = 0;
    });

    let unmatchedCount = 0;

    for (const tender of result.rows) {
      // Try AI category first
      if (tender.ai_category && tender.ai_category !== "General") {
        const mappedKey = AI_CATEGORY_MAP[tender.ai_category];
        if (mappedKey && INDUSTRIES[mappedKey]) {
          counts[mappedKey]++;
          continue;
        }
      }

      // Fall back to CPV matching
      const tenderCpvs = parseCpvCodes(tender.cpv_codes);
      let matchedAny = false;

      for (const [industryKey, industry] of Object.entries(INDUSTRIES)) {
        let matched = false;
        for (const industryCpv of industry.cpvCodes) {
          for (const tenderCpv of tenderCpvs) {
            if (cpvCodesMatch(industryCpv, tenderCpv)) {
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (matched) {
          counts[industryKey]++;
          matchedAny = true;
          break; // count each tender once
        }
      }

      if (!matchedAny) unmatchedCount++;
    }

    // Build response — only include categories with tenders
    const categories = Object.entries(INDUSTRIES)
      .map(([key, industry]) => ({
        key: key,
        name: industry.name,
        icon: industry.icon,
        tender_count: counts[key],
      }))
      .filter((c) => c.tender_count > 0);

    // Sort by tender count (highest first)
    categories.sort((a, b) => b.tender_count - a.tender_count);

    // Prepend "General / Other" count for unmatched tenders
    categories.unshift({
      key: "general",
      name: "General / Other",
      icon: "📄",
      tender_count: unmatchedCount,
    });

    res.json(categories);
  } catch (error) {
    console.error("❌ Error fetching categories:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get tenders (last 24 hours only)
app.get("/api/tenders", async (req, res) => {
  const { category } = req.query;
  const client = await getDatabaseClient();

  try {
    // Get tenders from last 24 hours only
    const result = await client.query(`
      SELECT * 
      FROM tenders 
      WHERE publication_date >= NOW() - INTERVAL '${TENDER_WINDOW}'
      ORDER BY publication_date DESC
    `);

    let tenders = result.rows;

    // Resolve the best industry key for a tender:
    // AI category takes priority; CPV matching is the fallback.
    function resolveIndustryKey(tender) {
      if (tender.ai_category && tender.ai_category !== "General") {
        const mapped = AI_CATEGORY_MAP[tender.ai_category];
        if (mapped) return mapped;
      }
      const cpvCodes = parseCpvCodes(tender.cpv_codes);
      return findIndustryForTender(cpvCodes);
    }

    function matchesAnyIndustry(tender) {
      const key = resolveIndustryKey(tender);
      return key && key !== "general";
    }

    if (category && INDUSTRIES[category]) {
      tenders = tenders.filter(
        (tender) => resolveIndustryKey(tender) === category,
      );
    } else {
      // No category (or "general") — show only unmatched tenders
      tenders = tenders.filter((tender) => !matchesAnyIndustry(tender));
    }

    // Format tenders for frontend
    const formattedTenders = tenders.map((tender) => {
      const industryKey = resolveIndustryKey(tender);
      const industry = INDUSTRIES[industryKey];

      return {
        id: tender.id,
        title: tender.title,
        summary: createSummary(tender.description),
        location: extractLocation(tender),
        value: formatContractValue(tender),
        deadline: formatDeadline(tender.deadline_date),
        category_key: industryKey,
        category_name: industry ? industry.name : "General",
        category_icon: industry ? industry.icon : "📄",
        buyer_name: tender.buyer_name,
        tender_url: tender.tender_url,
      };
    });

    res.json(formattedTenders);
  } catch (error) {
    console.error("❌ Error fetching tenders:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Generate LinkedIn posts
app.post("/api/generate-posts", async (req, res) => {
  const { tender_ids } = req.body;

  if (!Array.isArray(tender_ids) || tender_ids.length === 0) {
    return res.status(400).json({ error: "tender_ids array is required" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY environment variable is not set",
    });
  }

  const client = await getDatabaseClient();

  try {
    // Fetch the requested tenders
    const placeholders = tender_ids.map((_, i) => `$${i + 1}`).join(",");
    const result = await client.query(
      `SELECT * FROM tenders WHERE id IN (${placeholders})`,
      tender_ids,
    );

    const tenders = result.rows;

    if (tenders.length === 0) {
      return res.json({
        posts: [],
        generated_count: 0,
        message: "No tenders found with those IDs",
      });
    }

    console.log(`\n🤖 Generating ${tenders.length} LinkedIn post(s)...\n`);

    const generatedPosts = [];

    // Generate posts one by one
    for (let i = 0; i < tenders.length; i++) {
      const tender = tenders[i];
      const cpvCodes = parseCpvCodes(tender.cpv_codes);
      const industryKey = findIndustryForTender(cpvCodes);
      const industryName = INDUSTRIES[industryKey]
        ? INDUSTRIES[industryKey].name
        : "General";
      const teamMember = TEAM_MEMBERS[i % TEAM_MEMBERS.length];

      console.log(
        `  📝 [${i + 1}/${tenders.length}] ${tender.title.substring(0, 60)}...`,
      );

      try {
        const result = await generatePost(tender, industryName, teamMember, i);

        if (result.success) {
          // Save to database
          await client.query(
            `INSERT INTO generated_posts (tender_id, category, post_text, team_member, status) 
             VALUES ($1, $2, $3, $4, 'draft') 
             ON CONFLICT (tender_id, category) 
             DO UPDATE SET 
               post_text = EXCLUDED.post_text,
               team_member = EXCLUDED.team_member,
               status = 'draft',
               generated_at = NOW()`,
            [tender.id, industryKey, result.post_text, result.team_member],
          );

          generatedPosts.push({
            tender_id: tender.id,
            category: industryKey,
            post_text: result.post_text,
            team_member: result.team_member,
          });
        } else {
          console.error(`  ⚠️  Failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`  ⚠️  Error: ${error.message}`);
      }

      // Rate limiting delay
      if (i < tenders.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    console.log(`\n✅ Generated ${generatedPosts.length} post(s)\n`);

    res.json({
      posts: generatedPosts,
      generated_count: generatedPosts.length,
    });
  } catch (error) {
    console.error("❌ Error generating posts:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get post by tender ID
app.get("/api/posts/by-tender/:tenderId", async (req, res) => {
  const client = await getDatabaseClient();

  try {
    const result = await client.query(
      `SELECT * FROM generated_posts 
       WHERE tender_id = $1 
       ORDER BY generated_at DESC 
       LIMIT 1`,
      [req.params.tenderId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No post found for this tender" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error fetching post:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Update post
app.put("/api/posts/:id", async (req, res) => {
  const { post_text, status } = req.body;
  const client = await getDatabaseClient();

  try {
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (post_text !== undefined) {
      updates.push(`post_text = $${paramIndex}`);
      params.push(post_text);
      paramIndex++;
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      if (status === "published") {
        updates.push("published_at = NOW()");
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    params.push(parseInt(req.params.id));

    await client.query(
      `UPDATE generated_posts 
       SET ${updates.join(", ")} 
       WHERE id = $${paramIndex}`,
      params,
    );

    const result = await client.query(
      "SELECT * FROM generated_posts WHERE id = $1",
      [req.params.id],
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.error("❌ Error updating post:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Delete post
app.delete("/api/posts/:id", async (req, res) => {
  const client = await getDatabaseClient();

  try {
    await client.query("DELETE FROM generated_posts WHERE id = $1", [
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting post:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// ============================================================================
// SERVE FRONTEND
// ============================================================================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ============================================================================
// START SERVER
// ============================================================================

// LinkedIn OAuth routes
app.get("/auth/linkedin", (req, res) => {
  res.redirect(linkedin.getAuthUrl());
});

app.get("/auth/linkedin/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");
  try {
    await linkedin.exchangeCodeForToken(code);
    res.send(
      "<h1>✅ LinkedIn authenticated!</h1><p>You can close this window and go back to the dashboard.</p>",
    );
  } catch (e) {
    res.status(500).send("Authentication failed: " + e.message);
  }
});

app.get("/api/linkedin/status", (req, res) => {
  res.json({ authenticated: linkedin.isAuthenticated() });
});

app.post("/api/linkedin/post", async (req, res) => {
  const { post_text } = req.body;
  if (!post_text) return res.status(400).json({ error: "post_text required" });
  try {
    const result = await linkedin.postToLinkedIn(post_text);
    res.json({ success: true, message: "Posted to LinkedIn" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Push tracker rows to Google Sheets via Apps Script
const SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbwvc4R3sAGDmZNx3Y70fbsOZb0jEvw0RH4WXoKw1U5UpaX5HF3r2iCl04fZuid7P8i3/exec";

app.post("/api/push-to-sheets", async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: "No rows provided" });
  }
  try {
    const response = await fetch(SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
      redirect: "follow",
    });
    const text = await response.text();
    try {
      res.json(JSON.parse(text));
    } catch {
      res.json({ success: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AGENT ENDPOINTS
// ============================================================================

// GET /api/agent/pages — return Buffer page info
app.get("/api/agent/pages", (req, res) => {
  res.json(LINKEDIN_PAGES);
});

// GET /api/agent/test-buffer — send a test post to Buffer (scheduled 1 hour from now)
app.get("/api/agent/test-buffer", async (_req, res) => {
  try {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const testText =
      "🧪 This is a test post from the BWS LinkedIn tool. Please delete.";
    const result = await schedulePost(
      LINKEDIN_PAGES.main.id,
      testText,
      scheduledAt,
    );
    res.json({ success: true, result, scheduledAt });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ============================================================================
// TENDER SCANNER
// ============================================================================

// POST /api/scanner/scan — generate a LinkedIn post from a URL + pasted page content
app.post("/api/scanner/scan", async (req, res) => {
  const { url, pageContent } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, error: "URL required" });
  }
  try {
    console.log(`\n🔍 Scanner: generating post for ${url}`);
    const { writeTenderPost } = require("./agents/writer");
    const postText = await writeTenderPost(
      {
        tender_url: url.trim(),
        title: "",
        ai_category: "",
        buyer_name: "",
        status: "",
        deadline_date: null,
        value_amount: null,
        description: "",
      },
      0,
      pageContent ? pageContent.substring(0, 12000) : null,
    );
    res.json({ success: true, post_text: postText });
  } catch (err) {
    console.error("❌ Scanner error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// PIPELINE — CRON + MANUAL TRIGGER
// ============================================================================

// Ensure roundup_pool and weekly_config tables exist on startup
async function ensurePipelineTables() {
  const client = await getDatabaseClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS roundup_pool (
        id            SERIAL PRIMARY KEY,
        tender_id     VARCHAR(255) NOT NULL,
        title         TEXT NOT NULL,
        buyer_name    TEXT,
        value_amount  DECIMAL,
        value_currency VARCHAR(10) DEFAULT 'GBP',
        deadline_date TIMESTAMP,
        location      TEXT,
        description   TEXT,
        ai_category   VARCHAR(100),
        score         INTEGER DEFAULT 0,
        week_start    DATE NOT NULL,
        added_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (tender_id, week_start)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_config (
        key        VARCHAR(50) PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_logs (
        id               SERIAL PRIMARY KEY,
        run_at           TIMESTAMP DEFAULT NOW(),
        finished_at      TIMESTAMP,
        triggered_by     VARCHAR(20) DEFAULT 'cron',
        status           VARCHAR(20) DEFAULT 'running',
        day_type         VARCHAR(20),
        third_industry   VARCHAR(100),
        tenders_fetched  INTEGER DEFAULT 0,
        tenders_scored   INTEGER DEFAULT 0,
        posts_generated  INTEGER DEFAULT 0,
        posts_scheduled  INTEGER DEFAULT 0,
        roundup_added    INTEGER DEFAULT 0,
        duration_seconds DECIMAL,
        error_message    TEXT,
        scheduled_posts  JSONB DEFAULT '[]'
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS post_staging (
        id            SERIAL PRIMARY KEY,
        tender_id     TEXT UNIQUE,
        title         TEXT,
        url           TEXT,
        ai_category   TEXT,
        industry_key  TEXT,
        pages         TEXT,
        post_text     TEXT,
        proposed_slot TIMESTAMPTZ,
        status        TEXT DEFAULT 'pending',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add value columns if they don't exist yet (safe on existing tables)
    await client.query(
      `ALTER TABLE post_staging ADD COLUMN IF NOT EXISTS value_amount NUMERIC`,
    );
    await client.query(
      `ALTER TABLE post_staging ADD COLUMN IF NOT EXISTS value_currency TEXT DEFAULT 'GBP'`,
    );
    await client.query(
      `ALTER TABLE tenders ADD COLUMN IF NOT EXISTS delivery_location TEXT`,
    );
  } finally {
    client.release ? client.release() : await client.end();
  }
}

// GET /api/stager — return pipeline-scheduled posts for the LinkedIn Stager UI
app.get("/api/stager", async (_req, res) => {
  const client = await getDatabaseClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS linkedin_stager (
        id SERIAL PRIMARY KEY,
        tender_id TEXT,
        title TEXT,
        url TEXT,
        industry TEXT,
        post_text TEXT,
        scheduled_at TIMESTAMPTZ,
        channel TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const result = await client.query(
      "SELECT * FROM linkedin_stager ORDER BY created_at DESC LIMIT 200",
    );
    res.json({ success: true, rows: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await client.end();
  }
});

// DELETE /api/stager/clear — wipe all rows from linkedin_stager (used by "Clear All" button)
app.delete("/api/stager/clear", async (_req, res) => {
  const client = await getDatabaseClient();
  try {
    await client.query("DELETE FROM linkedin_stager");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await client.end();
  }
});

// POST /api/pipeline/run — manual trigger
app.post("/api/pipeline/run", async (_req, res) => {
  console.log("🔧 Manual pipeline trigger received");
  res.json({ success: true, message: "Pipeline started — check server logs" });
  runDailyPipeline("manual").catch((err) =>
    console.error("❌ Manual pipeline error:", err.message),
  );
});

// GET /api/agent/logs — last 30 pipeline runs
app.get("/api/agent/logs", async (_req, res) => {
  const client = await getDatabaseClient();
  try {
    const logs = await client.query(
      `SELECT id, run_at, finished_at, triggered_by, status, day_type,
              third_industry, tenders_fetched, tenders_scored, posts_generated,
              posts_scheduled, roundup_added, duration_seconds, error_message,
              scheduled_posts
       FROM pipeline_logs
       ORDER BY run_at DESC
       LIMIT 30`,
    );
    res.json({ success: true, logs: logs.rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    client.release ? client.release() : await client.end();
  }
});

// GET /api/pipeline/status — check cron schedule and third industry config
app.get("/api/pipeline/status", async (_req, res) => {
  const client = await getDatabaseClient();
  try {
    const config = await client.query(
      "SELECT key, value, updated_at FROM weekly_config",
    );
    const pool = await client.query(
      "SELECT ai_category, COUNT(*) as count FROM roundup_pool GROUP BY ai_category",
    );
    res.json({
      success: true,
      weekly_config: config.rows,
      roundup_pool: pool.rows,
      cron: "Mon-Fri 18:00 Europe/London",
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    client.release ? client.release() : await client.end();
  }
});

// Schedule the pipeline to run at 6pm Mon-Fri (UK time)
cron.schedule(
  "0 18 * * 1-5",
  () => {
    console.log("⏰ Cron triggered: running daily pipeline");
    runDailyPipeline("cron").catch((err) =>
      console.error("❌ Cron pipeline error:", err.message),
    );
  },
  { timezone: "Europe/London" },
);

app.listen(PORT, "0.0.0.0", () => {
  ensurePipelineTables().catch((err) =>
    console.error("⚠️  Could not create pipeline tables:", err.message),
  );
  console.log("\n" + "=".repeat(70));
  console.log("🚀 LinkedIn Post Generator");
  console.log("=".repeat(70));
  console.log(`📊 Dashboard:        http://localhost:${PORT}`);
  console.log(
    `🔑 OpenAI API Key:   ${process.env.ANTHROPIC_API_KEY ? "✅ Set" : "❌ MISSING"}`,
  );
  console.log(
    `🗄️  Database:         ${process.env.DATABASE_URL ? "✅ Connected" : "⚠️  Local"}`,
  );
  console.log(`⏰ Time Window:      Last 24 hours only`);
  console.log("=".repeat(70) + "\n");
});
