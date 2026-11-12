(function(exports) {
  "use strict";

  exports.calculate = function(scores, allowUnbreakableTies) {
    var i = 0;

    validateScores(scores);
    generateScores(scores);

    for (i = 0; i < scores.length; i++) {
      findPlace(i + 1, scores, allowUnbreakableTies);
    }
    expandDiagnostics(scores, allowUnbreakableTies);

    scores.sort(function(a, b) {
      if (a.position === b.position) {
        return 0;
      }
      return a.position > b.position ? 1 : -1;
    });
  };

  var validateScores = function(scores) {
    var i, judge, seen = [];
    for (i = 0; i < scores.length; i++) {
      for (judge = 0; judge < scores[i].scores.length; judge++) {
        var key = judge + '-' + scores[i].scores[judge];
        if (seen.indexOf(key) >= 0) {
          throw ("duplicate rank " + scores[i].scores[judge] + " for judge " + (judge + 1));
        } 
        seen.push(key);
      }
    }
  };

  var generateScores = function(scores) {
    var i, j;
    for (i = 0; i < scores.length; i++) {
      scores[i].cumulative = 0;
      scores[i].weighted = 0;

      for (j = 0; j < scores[i].scores.length; j++) {
        scores[i].cumulative += Number(scores[i].scores[j]);
        scores[i].weighted += (100 / (Number(scores[i].scores[j]) * 100));
      }
      scores[i].weighted = scores[i].weighted.toFixed(2);
    }
  };

  var expandDiagnostics = function(scores, allowUnbreakableTies) {
    var i, regexp = /^(\d+)P-(\d)+T-(.+)$/;

    for (i = 0; i < scores.length; i++) {
      var matches = regexp.exec(scores[i].diag);
      var place = matches[1];
      var tie = matches[2];
      var modifier = matches[3];
      if (modifier === 'M') {
        scores[i].diagmsg = 'Majority of or better';
      } else if(modifier.indexOf('S') >= 0) {
        scores[i].diagmsg = 'Lowest Total';
      } else if(modifier.indexOf('B') >= 0) {
        if (allowUnbreakableTies) {
          scores[i].diagmsg = 'Unbreakable Tie';
        } else {
          scores[i].diagmsg = 'Tie broken by Acting Judge';
        }
      } else if(modifier.indexOf('J') >= 0) {
        scores[i].diagmsg = "Judge's Preference";
      } else if(modifier.indexOf('D') >= 0) {
        scores[i].diagmsg = 'Decimal Points';
      }
 
    }
  };


  var findPlace = function(place, scores, allowUnbreakableTies) {
 
    if (place <= getGreatestPlace(scores)) {
      return;
    }
    // find candidates (all scores without position that have this score or less
    var result = findCandidates(place, scores);
    if (result.length == 0) {
      return;
    }

    var candidateType = result[0];
    var candidates = result[1];
    if (candidates.length == 1) {
      candidates[0].diag = place + "P-" + "0T-" + candidateType;
      candidates[0].position = place;
      return;
    }

    findCumulativeWinner(candidateType, place, candidates, allowUnbreakableTies);

    // if one candidate set its position and return
    // handle cumulative scores for candidates. i
    // break 2-way, 3-way, and 4-way ties with judges preference
    // break ties with decimal
    // if a tie still exists, sort it by the first judge, but keep the tie
  };

  var findCandidates = function(place, scores) {
    var i, j, majority = [];
    for (i = 0; i < scores.length; i++) {
      if (scores[i].position > 0) {
        continue;
      }
      var majorityCount = 0;
      for (j = 0; j < scores[i].scores.length; j++) {
        if (scores[i].scores[j] <= place) {
          majorityCount++;
        }
      }
      if (majorityCount > 1) {
        majority.push(scores[i]);
      }
    }
    if (majority.length == 0) {
      var keyedScores = findCumulativeKeyed(scores);
      var keys = Object.keys(keyedScores);
      if (keys.length == 0) {
        return [];
      }
      return ['S', keyedScores[keys[0]]];
    }
    return ['M', majority];
  };

  var findCumulativeKeyed = function(candidates) {

    var i, keyedScores = {};

    candidates.sort(function(a, b) {
      if (a.cumulative === b.cumulative) {
        return 0;
      }
      return a.cumulative < b.cumulative ? 1 : -1;
    });

    for (i = 0; i < candidates.length; i++) {
      if (candidates[i].position > 0) {
        continue;
      }

      if (!keyedScores[candidates[i].cumulative]) {
        keyedScores[candidates[i].cumulative] = [];
      }
      keyedScores[candidates[i].cumulative].push(candidates[i]);
    }

    return keyedScores;
  };

  var findCumulativeWinner = function(candidateType, place, candidates, allowUnbreakableTies) {

    var keyedScores = findCumulativeKeyed(candidates);

    var keys = Object.keys(keyedScores);
    if (keys.length == 0) {
      throw "Didn't find any cumulative winner for place " + place;
    }

// so the key is "have we assigned the place"

    var finalPlace = place;
    for (var key in keyedScores) {
      var winners = keyedScores[key];
      if (winners.length > 1) {
        if (winners.length == 2 && judgesPreference(candidateType, candidates.length, finalPlace, winners[0], winners[1])) {
          finalPlace += 2;
          continue;
        }
        findWeightedWinner(finalPlace, winners, allowUnbreakableTies);
      } else {
        winners[0].position = finalPlace;
        winners[0].diag = place + "P-" + candidates.length + "T-MS";
      }
      finalPlace += winners.length;
    }
  };

  var judgesPreference = function(candidateType, numTied, place, score1, score2) {

    var i, aScores = 0, bScores = 0;
    for(i = 0; i < score1.scores.length; i++) {
        if (score1.scores[i] < score2.scores[i]) {
          aScores++;
        } else {
          bScores++;
        }
    }

    if (aScores == bScores) {
      // judges tie
      score1.tie = true;
      score2.tie = true;
      breakTies(place, [score1, score2]);
      return false;
    }

    if (candidateType == 'S') {
      candidateType = '';
    }

    score1.position = (aScores > bScores ? place : place + 1);
    score1.diag = place + "P-" + numTied + "T-" + candidateType + "J";

    score2.position = (bScores > aScores ? place : place + 1);
    score2.diag = place + "P-" + numTied + "T-" + candidateType + "J";
    return true;
  };

  var findWeightedWinner = function(place, candidates, allowUnbreakableTies) {

    var i, keyedScores = {};

    candidates.sort(function(a, b) {
      if (a.weighted === b.weighted) {
        return 0;
      }
      return a.weighted < b.weighted ? 1 : -1;
    });

    for (i = 0; i < candidates.length; i++) {
      if (!keyedScores[candidates[i].weighted]) {
        keyedScores[candidates[i].weighted] = [];
      }
      keyedScores[candidates[i].weighted].push(candidates[i]);
    }


    var finalPlace = place;
    
    for (var key in keyedScores) {
      var winners = keyedScores[key];
      if (winners.length > 1) {
        if (winners.length == 2 && judgesPreference(key, candidates.length, finalPlace, winners[0], winners[1])) {
          finalPlace += 2;
          continue;
        }

        if (!allowUnbreakableTies) {
          winners.sort(function(a, b) {
            if (a.position == b.position) {
              // acting judge
              return a.scores[0] > b.scores[0] ? 1 : -1;
            }
          });
        }

        for (i = 0; i < winners.length; i++) {
      
    
          winners[i].tie = true;
          winners[i].diag = place + "P-" + candidates.length + "T-" + winners[0].weighted + "B";

          if (allowUnbreakableTies) {
            winners[i].position = finalPlace;
          } else {
            winners[i].position = finalPlace + i;
          }
        }

    
        if (allowUnbreakableTies) {
          finalPlace++;
        } else {
          finalPlace += winners.length;
        }
      } else {

        winners[0].position = finalPlace;
        winners[0].diag = place + "P-" + candidates.length + "T-" + winners[0].weighted + "D";
        finalPlace++;
      }
    }

  };

  var getGreatestPlace = function(scores) {
    var i, greatestPlace = 0;
    for (i = 0; i < scores.length; i++) {
      if (scores[i].position > greatestPlace) {
        greatestPlace = scores[i].position;
      }
    }
    return greatestPlace;
  }



})(typeof exports === 'undefined'? this['rank']={}: exports);
