use crate::format::format_name;

pub struct Greeter {
    pub prefix: String,
    count: usize,
}

pub enum Status {
    Ready,
    Error(String),
    Named { code: i32 },
}

pub trait Runner {
    fn run(&self, input: &str) -> String;
}

impl Greeter {
    pub fn new(prefix: String) -> Self {
        Self { prefix, count: 0 }
    }

    pub async fn run(&self, input: &str) -> String {
        format_name(input)
    }
}

pub fn add(left: i32, right: i32) -> i32 {
    left + right
}
