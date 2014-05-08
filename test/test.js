//example test: https://gist.github.com/vgheri/5430387#file-test-js

var chai = require('chai'),
    expect = chai.expect,
    Promise = require('bluebird'),
    DB = require('../lib/DB'),
    dbConfig = {
        host: 'localhost',
        port: 28015,
        db: 'test',
        pool: {
            max: 100,
            min: 0,
            log: false,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 15000
        }
    },
    db = new DB(dbConfig),
    Rethinker = require('../lib/Rethinker').init(dbConfig),
    r = require('rethinkdb');


var LecturesManager = Rethinker.extend({
    modelName: 'Lecture',
    tableName: 'lectures',
    relations: {
        hasOne: {
            course: {
                on: 'courseId',
                from: 'Course'
            },
            video: {
                on: 'videoId',
                from: 'Video',
                sync: true
            }
        }
    }
});

var CoursesManager = Rethinker.extend({
    modelName: 'Course',
    tableName: 'courses',
    relations: {
        hasMany: {
            lectures: {
                on: 'courseId',
                from: 'Lecture'
            },
            videoLectures: {
                on: 'courseId',
                from: 'Lecture'
            },
            students: {
                on: ['courseId', 'studentId'],
                through: 'courses_students',
                from: 'Student'
            }
        },
        hasOne: {
            lecture4: {
                on: 'courseId',
                from: 'Lecture',
                filter: {
                    title: 'Lecture4'
                },
                sync: 'readOnly'
            },
            lecture3: {
                on: 'courseId',
                from: 'Lecture',
                filter: {
                    title: 'Lecture3'
                }
            },
            privateLecture: {
                on: 'courseId',
                from: 'Lecture',
                filter: {
                    private: true
                },
                sync: true
            },
            lectureSpecial: {
                on: 'courseId',
                from: 'Lecture',
                filter: {
                    title: 'Lecture Special'
                },
                sync: true
            }
        }
    }
});

var StudentsManager = Rethinker.extend({
    modelName: 'Student',
    tableName: 'students',
    relations: {
        hasMany: {
            'enrolledCourses': {
                on: ['studentId', 'courseId'],
                through: {
                    tableName: 'courses_students',
                    filter: {
                        enrolled: true
                    }
                },
                from: 'Course'
            }
        }
    }
});

var VideosManager = Rethinker.extend({
    modelName: 'Video',
    tableName: 'videos'
})

var lecturesManager = new LecturesManager();
var coursesManager = new CoursesManager();
var studentsManager = new StudentsManager();
var videosManager = new VideosManager();

var lectures, students, courses, videos;

describe('Rethinker', function () {
    this.timeout(11000);

    before(function (done) {
        Promise.all([
            db.run(r.tableDrop('courses')),
            db.run(r.tableDrop('students')),
            db.run(r.tableDrop('lectures')),
            db.run(r.tableDrop('courses_students')),
            db.run(r.tableDrop('videos'))
        ]).then(function () {
            return Promise.all([
                db.run(r.tableCreate('courses')),
                db.run(r.tableCreate('lectures')),
                db.run(r.tableCreate('students')),
                db.run(r.tableCreate('courses_students')),
                db.run(r.tableCreate('videos'))
            ])
        }).then(function () {
            return Promise.all([
                db.run(r.table('lectures').indexCreate('courseId')),
                db.run(r.table('courses_students').indexCreate('courseId')),
                db.run(r.table('courses_students').indexCreate('studentId'))
            ])
        }).then(function () {
            done();

        });
    });

    describe('testing Rethinker extend', function () {

        it('should add corresponding properties to the inherited child', function (done) {
            expect(lecturesManager.db.config.db).to.be.equal('test');
            expect(lecturesManager.modelName).to.be.equal('Lecture');
            expect(lecturesManager.tableName).to.be.equal('lectures');
            expect(lecturesManager).to.have.property('findAllLecture');
            expect(coursesManager).to.have.property('relations');
            expect(coursesManager.relations.hasMany.lectures.on).to.be.equal('courseId');
            expect(coursesManager).to.have.property('findAllCourse');
            expect(coursesManager).to.have.property('buildQuery');
            done();
        })

    });

    describe('testing create methods', function () {

        it('should create all models and their relationships', function (done) {

            coursesManager.createCourse([
                {title: 'Course1'},
                {title: 'Course2'}
            ]).then(function (results) {
                courses = results;
                return videosManager.createVideo([
                    {url: 'dir/video1.mp4'},
                    {url: 'dir/video2.mp4'},
                    {url: 'dir/video3.mp4'},
                    {url: 'dir/video4.mp4'}
                ]);
            }).then(function (results) {
                videos = results;
                return lecturesManager.createLecture([
                    {title: 'Lecture1', courseId: courses[0].id, videoId: videos[0].id, private: false},
                    {title: 'Lecture2', courseId: courses[0].id, videoId: videos[1].id, private: false},
                    {title: 'Lecture3', courseId: courses[1].id, videoId: videos[2].id, private: false},
                    {title: 'Lecture4', courseId: courses[1].id, videoId: null, private: false}
                ]);
            }).then(function (classResults) {
                lectures = classResults;
                return studentsManager.createStudent([
                    {name: "Student1", email: "student1@inst1.edu"},
                    {name: "Student2", email: "student2@inst1.edu"},
                    {name: "Student3", email: "student3@inst2.edu"},
                    {name: "Student4", email: "student4@inst2.edu"}
                ])
            }).then(function (results) {
                students = results;
                return db.run(r.table('courses_students').insert([
                    {courseId: courses[0].id, studentId: students[0].id, enrolled: true},
                    {courseId: courses[0].id, studentId: students[1].id, enrolled: false},
                    {courseId: courses[1].id, studentId: students[1].id, enrolled: true},
                    {courseId: courses[1].id, studentId: students[2].id, enrolled: false},
                    {courseId: courses[1].id, studentId: students[3].id, enrolled: true}
                ]))
            }).then(function (results) {
                done();
            });

        });


    });

    describe('testing relational queries', function () {

        it('should find MULTIPLE courses with MANY lectures', function (done) {

            coursesManager.findAllCourse(null, {
                with: {
                    related: 'lectures',
                    orderBy: 'title',
                    with: 'course'
                }, orderBy: 'title'})
                .then(function (courses) {
                    expect(courses[0].lectures.length).to.be.equal(2);
                    expect(courses[0].lectures[0].title).to.be.equal('Lecture1');
                    expect(courses[0].lectures[0].course.title).to.be.equal('Course1');
                    expect(courses[0].lectures[1].title).to.be.equal('Lecture2');
                    expect(courses[0].lectures[1].course.title).to.be.equal('Course1');
                    expect(courses[1].lectures.length).to.be.equal(2);
                    expect(courses[1].lectures[0].course.title).to.be.equal('Course2');
                    done();
                })
        });

        it('should find MULTIPLE courses with MANY video lectures', function (done) {

            coursesManager.findAllCourse(null, {
                with: {
                    related: 'videoLectures',
                    orderBy: 'title'
                }, orderBy: 'title'})
                .then(function (courses) {
                    expect(courses[0].videoLectures.length).to.be.equal(2);
                    done();
                })
        });

        it('should find MULTIPLE lectures with ONE video', function (done) {

            lecturesManager.findAllLecture(null, {
                with: 'video',
                orderBy: 'title'
            }).then(function (lectures) {
                expect(lectures.length).to.be.equal(4);
                expect(lectures[2].video.url).to.be.equal('dir/video3.mp4');
                expect(lectures[3].video).to.be.equal(null);
                done();
            });

        });

        it('should find MULTIPLE courses with ONE private lecture', function (done) {
            coursesManager.findAllCourse(null, {
                with: {
                    related: "lecture4",
                    with: 'course'
                },
                orderBy: 'title'
            }).then(function (courses) {
                expect(courses[1].lecture4.title).to.be.equal("Lecture4");
                expect(courses[1].lecture4.course.title).to.be.equal("Course2");
                done();
            })
        })

        it('should find MULTIPLE courses with MANY students', function (done) {

            coursesManager.findAllCourse(null, {
                with: {
                    related: 'students',
                    orderBy: 'name desc',
                    with: 'enrolledCourses'
                },
                orderBy: 'title'
            }).then(function (courses) {
                expect(courses.length).to.be.equal(2);
                expect(courses[0].students.length).to.be.equal(2);
                expect(courses[0].students[0].name).to.be.equal('Student2');
                expect(courses[0].students[1].name).to.be.equal('Student1');
                expect(courses[0].students[0].enrolledCourses.length).to.be.equal(1);
                expect(courses[0].students[0].enrolledCourses[0].title).to.be.equal('Course2');
                expect(courses[1].students.length).to.be.equal(3);
                done();
            });

        });

        it('should find MULTIPLE courses with MANY students with custom filter for through table', function (done) {

            coursesManager.findAllCourse(null, {
                with: {
                    related: 'students',
                    orderBy: 'name desc',
                    with: {
                        related: 'enrolledCourses',
                        filterThrough: {
                            enrolled: false
                        }
                    }
                },
                orderBy: 'title'
            }).then(function (courses) {
                expect(courses[0].students[0].enrolledCourses[0].title).to.be.equal('Course1');
                done();
            });

        });


        it('should find a SINGLE course with MANY lectures', function (done) {

            coursesManager.findCourse(courses[0].id, {
                with: {
                    related: 'lectures',
                    orderBy: 'title'
                }
            }).then(function (course) {
                expect(course).to.have.property('lectures');
                expect(course.lectures.length).to.be.equal(2);
                expect(course.lectures[0].title).to.be.equal('Lecture1');
                expect(course.lectures[1].title).to.be.equal('Lecture2');


                done();
            });

        });

        it('should find SINGLE lectures with ONE video', function (done) {

            lecturesManager.findLecture(lectures[0].id, {
                with: 'video'
            }).then(function (lecture) {
                expect(lecture.video.url).to.be.equal('dir/video1.mp4');
                done();
            });

        });

        it('should find SINGLE course with ONE lecture named Lecture4', function (done) {

            coursesManager.findCourse(courses[1].id, {
                with: 'lecture4'
            }).then(function (course) {
                expect(course.lecture4.title).to.be.equal('Lecture4');
                done();
            });

        });

        it('should find SINGLE course with nonexistent relationship equals null', function (done) {

            coursesManager.findCourse(courses[0].id, {
                with: 'lecture3'
            }).then(function (course) {
                expect(course.lecture3).to.be.equal(null);
                done();
            });

        });

        it('should find SINGLE course with many HASONE relationships', function (done) {

            coursesManager.findCourse(courses[1].id, {
                with: [
                    {
                        related: 'lecture3',
                        with: {
                            related: 'video'
                        }
                    },
                    'lecture4'
                ]
            }).then(function (course) {
                expect(course.lecture3.title).to.be.equal("Lecture3");
                expect(course.lecture3.video.url).to.be.equal("dir/video3.mp4");
                expect(course.lecture4.title).to.be.equal("Lecture4");
                done();
            });

        });

        it('should find SINGLE course with MANY students filtered by institutional email', function (done) {

            coursesManager.findCourse(courses[1].id, {
                with: {
                    related: 'students',
                    orderBy: 'name',
                    filter: function (student) {
                        return student('email').match('inst1.edu');
                    }
                },
                orderBy: 'title'
            }).then(function (course) {
                expect(course.students.length).to.be.equal(1);
                done();
            });

        });


    });

    describe('testing save relationships', function () {
        var privateLecture;
        var newCourse = {
            title: 'Course3',
            privateLecture: {title: 'Lecture5', videoId: null, private: true},
            lectureSpecial: {title: 'Lecture Special', video: {url: 'dir/video5.mp4'}}
        };
        describe('when create a new entity with a new HASONE relationship', function () {

            it('should create a course with the related properties', function (done) {
                coursesManager.createCourse(newCourse).then(function (course) {
                    newCourse = course;
                    expect(course).to.have.property('privateLecture');
                    expect(course.lectureSpecial.title).to.be.equal("Lecture Special");
                    expect(course.lectureSpecial).to.have.property('video');
                    expect(course.lectureSpecial.video.url).to.be.equal('dir/video5.mp4');
                    expect(course.privateLecture.private).to.be.equal(true);
                    expect(course.privateLecture).to.have.property('createTime');
                    done();
                })
            });

            it('should not save privateLecture property in course', function (done) {
                coursesManager.findCourse(newCourse.id).then(function (course) {
                    expect(course).to.not.have.property('privateLecture');
                    expect(course).to.not.have.property('lectureSpecial');
                    done();
                });
            });

            it('should create a private lecture in lectures', function (done) {
                lecturesManager.findLecture({private: true}).then(function (lecture) {
                    privateLecture = lecture;
                    expect(lecture.courseId).to.be.equal(newCourse.id);
                    expect(lecture.private).to.be.equal(true);
                    done();
                });
            });


        });

        describe('when create a new entity with a existing HASONE relationship that has no longer valid filter criteria', function () {
            var newCourse2 = {title: 'Course4'};

            it('should create a course with the related properties', function (done) {
                newCourse2.privateLecture = privateLecture;
                newCourse2.privateLecture.title = "Updated Private Lecture";
                newCourse2.privateLecture.private = false;
                coursesManager.createCourse(newCourse2).then(function (course) {
                    newCourse2 = course;
                    expect(course).to.have.property('privateLecture');
                    expect(course.privateLecture).to.be.equal(null);
                    done();
                })
            });

            it('should not save privateLecture property in course', function (done) {
                coursesManager.findCourse(newCourse2.id).then(function (course) {
                    expect(course).to.not.have.property('privateLecture');
                    done();
                });
            });

            it('should update the private lecture in lectures', function (done) {
                lecturesManager.findLecture(privateLecture.id).then(function (lecture) {
                    expect(lecture.title).to.be.equal("Updated Private Lecture");
                    expect(lecture).to.have.property("updateTime");
                    expect(lecture.private).to.be.equal(false);
                    done();
                });
            });

        });


        describe('when update a entity with a existing HASONE relationship', function () {
            var existingCourse;

            before(function (done) {
                existingCourse = newCourse;
                lecturesManager.createLecture({title: 'Lecture4', courseId: existingCourse.id}).then(function () {
                    done();
                });
            });

            it('should update the existing relationship', function (done) {
                existingCourse.privateLecture.title = "Lecture6";
                existingCourse.lecture4 = {title: 'Lecture4 changed'};
                coursesManager.updateCourse(existingCourse, existingCourse.id)
                    .then(function (course) {
                        existingCourse = course;

                        expect(course.lecture4.title).to.be.equal('Lecture4');
                        expect(course.privateLecture.title).to.be.equal('Lecture6');
                        done();
                    });

            });

            it('should not save privateLecture property in course', function (done) {
                coursesManager.findCourse(existingCourse.id).then(function (course) {
                    expect(course).to.not.have.property('privateLecture');
                    done();
                });
            });

            it('should not retrieve the invalid relationship after update', function (done) {
                existingCourse.privateLecture.private = false;
                coursesManager.updateCourse(existingCourse, existingCourse.id)
                    .then(function (course) {
                        expect(course.privateLecture).to.be.equal(null);
                        done();
                    });

            });


        });

    })

    describe('testing CRUD operations', function(){

        it('should update all the students from inst1.edu with grade = 0', function(done){

            studentsManager.updateAllStudent({grade : 0}, function(student){
                return student('email').match('inst1.edu');
            }).then(function(students){
                expect(students.length).to.be.equal(2);
                for (var i = 0, ll = students.length; i < ll; i++) {
                  var student = students[i];
                  expect(student.grade).to.be.equal(0);
                }
                done();
            })
        })

    });
})