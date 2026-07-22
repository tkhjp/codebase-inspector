package sample

import "example.local/project/format"

type Greeter struct {
	Prefix string
	count  int
	Tags   []string
}

type Runner interface {
	Run(input string) string
	private(value int) error
}

func NewGreeter(prefix string) *Greeter {
	return &Greeter{Prefix: prefix}
}

func (g *Greeter) Run(input string) string {
	return format.Name(input)
}

func (g Greeter) private(value int) error {
	return nil
}
